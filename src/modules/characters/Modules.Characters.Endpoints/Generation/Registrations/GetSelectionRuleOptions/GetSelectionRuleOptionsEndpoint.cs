using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Registrations;
using Starlights.Modules.Characters.Endpoints.Models;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Integration.Models;
using Starlights.Modules.Characters.Services.Statistics;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Generation.Registrations.GetSelectionRuleOptions;

public sealed class GetSelectionRuleOptionsEndpoint : EndpointWithoutRequest<GetSelectionRuleOptionsResponse>
{
    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;
    private readonly ISpellIndex _spells;
    private readonly StatisticsCalculator _statistics;

    public GetSelectionRuleOptionsEndpoint(IPersistence persistence, IElementsModuleQueries elements, ISpellIndex spells, StatisticsCalculator statistics)
    {
        _persistence = persistence;
        _elements = elements;
        _spells = spells;
        _statistics = statistics;
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

        var elements = await SpellOptionsAsync(character, characterRegistrations, owner, selectionRule, supports, ct)
            ?? await _elements.GetSelectionOptions(selectionRule.ElementType, supports);

        // like Aurora: leave out what the character already has (a skill it is proficient in, a feat it took),
        // except this slot's own pick and what may be taken again (Aurora's "allow duplicate"), and list repeatable copies of an element (the nine "Skilled") once
        var owned = characterRegistrations.Select(r => r.AssociatedElementId.Value).ToHashSet();
        var current = selectionRule.SelectedOption?.Value;
        // a choice only one edition's books fill stays open for the other edition: when none of the ticked books
        // offer anything, every book counts. Gods are setting lore, not rules (the 2024 Player's Handbook has no
        // pantheons), so a deity can come from any book.
        var allowed = elements.Where(e => e.Id == current || e.AllowDuplicate || !owned.Contains(e.Id)).ToList();
        if (selectionRule.ElementType != "Deity" && allowed.Any(e => !character.RestrictedSources.Contains(e.Source)))
        {
            allowed = allowed.Where(e => e.Id == current || !character.RestrictedSources.Contains(e.Source)).ToList();
        }

        var seen = new HashSet<(string, string?)>();
        var options = allowed
            .OrderByDescending(e => e.Id == current)
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

    /// <summary>
    /// A spell selection like Aurora's "$(spellcasting:list), $(spellcasting:slots)": the spells on this character's
    /// lists for that spellcasting (with lists added by features such as Magical Secrets) of the levels it has slots
    /// for; a number is a spell level ("…, 0" is cantrips). Null when it is not such a selection or cannot be worked
    /// out, so the plain supports filter applies instead.
    /// </summary>
    private async Task<List<ElementDataModel>?> SpellOptionsAsync(
        Character character,
        IReadOnlyCollection<Registration> registrations,
        Registration owner,
        RegistrationSelectionRule selectionRule,
        string? supports,
        CancellationToken ct)
    {
        if (!string.Equals(selectionRule.ElementType, "Spell", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(supports))
        {
            return null;
        }

        // without placeholders only the numbers need reading as spell levels ("0,Cleric": a cleric cantrip)
        if (!supports.Contains("$(spellcasting:", StringComparison.OrdinalIgnoreCase))
        {
            return await Keep(await _spells.GetSpellOptionsAsync(supports, [], [], ct));
        }

        var definitions = await _spells.GetSpellcastingAsync(registrations.Select(r => r.AssociatedElementId.Value).Distinct().ToList(), ct);
        var spellcasting = await _spells.GetSelectSpellcastingAsync(owner.AssociatedElementId.Value, selectionRule.Name, ct);
        var own = definitions.Where(d => spellcasting is null ? !d.Extend : string.Equals(d.Name, spellcasting, StringComparison.OrdinalIgnoreCase)).ToList();
        var lists = own.Where(d => !d.Extend).SelectMany(d => d.Lists).Concat(own.Where(d => d.Extend).SelectMany(d => d.Extends)).Distinct().ToList();
        if (lists.Count == 0 && supports.Contains("$(spellcasting:list)", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        // the spell levels this spellcasting has slots for (its own table; pact magic: up to the pact slot level)
        var statistics = _statistics.Calculate(character, [.. registrations]).Statistics;
        var names = (spellcasting is null ? own.Select(d => d.Name) : [spellcasting]).Select(n => n.ToLowerInvariant().Replace(' ', '-')).Distinct().ToList();
        var levels = new SortedSet<int>();
        foreach (var name in names)
        {
            for (var level = 1; level <= 9; level++)
            {
                if (statistics.TryGetGroup($"{name}:spellcasting:slots:{level}", out var group) && group.IsCompleted && group.Sum() > 0)
                {
                    levels.Add(level);
                }
            }
            if (statistics.TryGetGroup($"{name}:spellcasting:slot", out var pact) && pact.IsCompleted)
            {
                for (var level = 1; level <= pact.Sum(); level++)
                {
                    levels.Add(level);
                }
            }
        }

        return await Keep(await _spells.GetSpellOptionsAsync(supports, lists, levels, ct));

        async Task<List<ElementDataModel>> Keep(List<SpellInfo> spells)
        {
            var ids = spells.Select(s => s.Id).ToHashSet();
            if (selectionRule.SelectedOption?.Value is { } picked)
            {
                // an earlier pick stays offered even if it no longer fits (a changed level, an updated book)
                ids.Add(picked);
            }
            return (await _elements.GetSelectionOptions(selectionRule.ElementType, null)).Where(e => ids.Contains(e.Id)).ToList();
        }
    }
}
