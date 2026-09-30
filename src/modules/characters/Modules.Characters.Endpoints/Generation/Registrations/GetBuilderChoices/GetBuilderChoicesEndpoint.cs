using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Registrations;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Integration.Models;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Generation.Registrations.GetBuilderChoices;

public sealed record BuilderChoiceSelection(Guid ElementId, string Name, string? Source);

/// <summary>
/// One choice slot of a character, in build order. A "choose 2" rule gives two slots (Slot 1 and 2 of 2).
/// </summary>
public sealed record BuilderChoice
{
    /// <summary>The slot (registration selection rule) id, used to fetch options and register a pick.</summary>
    public required Guid RuleId { get; init; }

    /// <summary>The registration the slot belongs to, needed when registering a pick.</summary>
    public required Guid RegistrationId { get; init; }

    /// <summary>The top-level choice this slot hangs under: Class, Species, Background, Alignment, …</summary>
    public required string Section { get; init; }

    /// <summary>Nesting below the section's top choice (0 = the class/species/background pick itself).</summary>
    public required int Depth { get; init; }

    public required string Name { get; init; }
    public required string Type { get; init; }
    public required string ParentName { get; init; }
    public required Guid ParentElementId { get; init; }
    public required string ParentType { get; init; }
    public int Level { get; init; }
    public int Slot { get; init; } = 1;
    public int Slots { get; init; } = 1;

    /// <summary>A choice that may stay empty (a deity, Aurora's optional selects).</summary>
    public bool Optional { get; init; }
    public BuilderChoiceSelection? Selected { get; init; }
}

public sealed record GetBuilderChoicesResponse(List<BuilderChoice> Choices, bool Pending);

/// <summary>
/// Every choice of a character in one call, ordered and nested the way Aurora's build tab shows them:
/// a slot is followed by the choices its pick brings, and a registration's own choices by those of the
/// features it includes. <c>Pending</c> is true while registrations still await background processing.
/// </summary>
public sealed class GetBuilderChoicesEndpoint : EndpointWithoutRequest<GetBuilderChoicesResponse>
{
    private static readonly HashSet<string> RootTypes = ["Rule", "Character Creation"];

    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;

    public GetBuilderChoicesEndpoint(IPersistence persistence, IElementsModuleQueries elements)
    {
        _persistence = persistence;
        _elements = elements;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/builder/choices");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var characterId = new CharacterId(Route<Guid>("characterId"));

        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(characterId);
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var registrations = await _persistence.GetRepository<IRegistrationRepository>().GetRegistrationsAsync(character.Id);
        var elements = (await _elements.GetElementsWithRules(registrations.Select(r => r.AssociatedElementId.Value).Distinct().ToList()))
            .ToDictionary(e => e.Id);

        var byId = registrations.ToDictionary(r => r.Id);
        var children = registrations
            .Where(r => r.ParentRegistrationId is not null)
            .ToLookup(r => r.ParentRegistrationId!.Value);
        var roots = registrations.Where(r => r.ParentRegistrationId is null || !byId.ContainsKey(r.ParentRegistrationId.Value));

        var choices = new List<BuilderChoice>();
        var visited = new HashSet<RegistrationId>();

        void Walk(Registration registration, int depth, string? section)
        {
            if (!visited.Add(registration.Id))
            {
                return;
            }

            var element = elements.GetValueOrDefault(registration.AssociatedElementId.Value);
            var definitions = element?.SelectionRules ?? [];
            var isRoot = RootTypes.Contains(registration.AssociatedElementType);
            var picked = new HashSet<RegistrationId>();

            int DefinitionOrder(Guid ruleId)
            {
                var index = definitions.FindIndex(d => d.RuleId == ruleId);
                return index < 0 ? int.MaxValue : index;
            }

            var slotsByRule = registration.SelectionRules
                .GroupBy(s => s.AssociatedSelectionRuleId.Value)
                .OrderBy(g => DefinitionOrder(g.Key));

            foreach (var rule in slotsByRule)
            {
                var definition = definitions.FirstOrDefault(d => d.RuleId == rule.Key);
                var slots = rule.OrderBy(s => s.Id.Value).ToList();

                for (var i = 0; i < slots.Count; i++)
                {
                    var slot = slots[i];
                    var slotSection = section ?? (isRoot ? slot.ElementType : "Other");
                    var selected = slot.SelectionRegistrationId is { } selectedId ? byId.GetValueOrDefault(selectedId) : null;

                    choices.Add(new BuilderChoice
                    {
                        RuleId = slot.Id.Value,
                        RegistrationId = registration.Id.Value,
                        Section = slotSection,
                        Depth = depth,
                        Name = slot.Name,
                        Type = slot.ElementType,
                        ParentName = registration.AssociatedElementName,
                        ParentElementId = registration.AssociatedElementId.Value,
                        ParentType = registration.AssociatedElementType,
                        Level = definition?.LevelRequirement ?? 0,
                        Slot = i + 1,
                        Slots = slots.Count,
                        Optional = definition?.Optional ?? false,
                        Selected = selected is null ? null : new BuilderChoiceSelection(
                            selected.AssociatedElementId.Value,
                            selected.AssociatedElementName,
                            SourceOf(elements.GetValueOrDefault(selected.AssociatedElementId.Value)))
                    });

                    if (selected is not null)
                    {
                        picked.Add(selected.Id);
                        Walk(selected, depth + 1, slotSection);
                    }
                }
            }

            // included features (e.g. "Level 1: Fighting Style") add their choices at the same level as their owner's
            foreach (var child in children[registration.Id].Where(c => !picked.Contains(c.Id)).OrderBy(c => c.Id.Value))
            {
                Walk(child, depth, section);
            }
        }

        // registrations attached outside the build: extras, and active items with choices (a magic item that lets
        // you pick a spell); their choices get sections of their own
        var extras = character.Extras.Select(e => e.RegistrationId).OfType<Guid>().ToHashSet();
        var equipment = character.Inventory.Items.Select(i => i.RegistrationId).OfType<Guid>().ToHashSet();
        foreach (var root in roots.OrderBy(r => r.Id.Value))
        {
            var section = extras.Contains(root.Id.Value) ? "Extras" : equipment.Contains(root.Id.Value) ? "Equipment" : null;
            Walk(root, 0, section);
        }

        await Send.OkAsync(new GetBuilderChoicesResponse(choices, registrations.Any(r => !r.IsProcessed)), ct);
    }

    private static string? SourceOf(ElementDataModel? element) =>
        element is null || element.Source == "Internal" ? null : element.Source;
}
