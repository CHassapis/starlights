using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Registrations;
using Starlights.Modules.Characters.Endpoints.Models;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Generation.Registrations.GetSelectionRuleOptions;

public sealed class GetSelectionRuleOptionsEndpoint : EndpointWithoutRequest<GetSelectionRuleOptionsResponse>
{
    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;

    public GetSelectionRuleOptionsEndpoint(IPersistence persistence, IElementsModuleQueries elements)
    {
        _persistence = persistence;
        _elements = elements;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/builder/selection-rules/{ruleId:guid}/options");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        using var _ = CharactersInstrumentation.StartActivity(nameof(GetSelectionRuleOptionsEndpoint));

        var characterId = new CharacterId(Route<Guid>("characterId"));
        var ruleId = new RegistrationSelectionRuleId(Route<Guid>("ruleId"));

        var characters = _persistence.GetRepository<ICharactersRepository>();
        var character = await characters.GetCharacterAsync(characterId);
        if (character is null)
        {
            AddError($"The character '{characterId}' does not exist.");
            await Send.NotFoundAsync(cancellation: ct);
            return;
        }

        var registrations = _persistence.GetRepository<IRegistrationRepository>();
        var characterRegistrations = await registrations.GetRegistrationsAsync(character.Id);

        var selectionRule = characterRegistrations.SelectMany(x => x.SelectionRules)
            .SingleOrDefault(x => x.Id == ruleId);

        if (selectionRule is null)
        {
            AddError($"The selection rule '{ruleId}' does not exist for character '{characterId}'.");
            await Send.NotFoundAsync(cancellation: ct);
            return;
        }

        // narrow the options by the rule's supports expression, which lives on the rule definition of the owning element
        var owner = characterRegistrations.Single(x => x.Id == selectionRule.ParentRegistrationId);
        var ownerElement = await _elements.GetElementWithRules(owner.AssociatedElementId);
        var supports = ownerElement?.SelectionRules.SingleOrDefault(x => x.RuleId == selectionRule.AssociatedSelectionRuleId.Value)?.Supports;

        var elements = await _elements.GetSelectionOptions(selectionRule.ElementType, supports);

        // like Aurora: leave out what the character already has (a skill it is proficient in, a feat it took),
        // except this slot's own pick, and list repeatable copies of an element (the nine "Skilled") once
        var owned = characterRegistrations.Select(r => r.AssociatedElementId.Value).ToHashSet();
        var current = selectionRule.SelectedOption?.Value;
        var seen = new HashSet<(string, string?)>();
        var options = elements
            .OrderByDescending(e => e.Id == current)
            .Where(e => e.Id == current || !owned.Contains(e.Id))
            .Where(e => e.Id == current || !character.RestrictedSources.Contains(e.Source))
            .Where(e => seen.Add((e.Name, e.Source)))
            .OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Source)
            .ToList();

        var response = new GetSelectionRuleOptionsResponse
        {
            Options = options.ConvertAll(e => new SelectionRuleOptionModel { ElementId = e.Id, Name = e.Name, Source = e.Source == "Internal" ? null : e.Source })
        };

        await Send.OkAsync(response, ct);
    }
}
