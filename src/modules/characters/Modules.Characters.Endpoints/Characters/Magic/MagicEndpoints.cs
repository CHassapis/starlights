using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Abilities;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Classes;
using Starlights.Modules.Characters.Services.Magic;
using Starlights.Modules.Characters.Services.Statistics;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Magic;

/// <summary>
/// How a character casts spells, worked out from its build: per spellcasting its ability, attack and save DC, slots,
/// spells (and which are always prepared) and what it may prepare. The Magic tab and the sheet read this.
/// </summary>
public sealed class GetSpellcastingEndpoint : EndpointWithoutRequest<SpellcastingFactsModel>
{
    private readonly IPersistence _persistence;
    private readonly ISpellIndex _spells;
    private readonly StatisticsCalculator _statistics;

    public GetSpellcastingEndpoint(IPersistence persistence, ISpellIndex spells, StatisticsCalculator statistics)
    {
        _persistence = persistence;
        _spells = spells;
        _statistics = statistics;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/spellcasting");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var registrations = await _persistence.GetRepository<IRegistrationRepository>().GetRegistrationsAsync(character.Id);
        var statistics = _statistics.Calculate(character, [.. registrations]).Statistics;
        int? Statistic(string name) => statistics.TryGetGroup(name, out var group) && group.IsCompleted ? group.Sum() : null;
        var abilities = character.GetRequiredComponent<AbilitiesComponent>().AbilityScores;
        var classes = character.GetRequiredComponent<ClassComponent>();

        var input = new MagicCharacter(
            registrations.Select(r => new MagicRegistration(
                r.Id.Value,
                r.ParentRegistrationId?.Value,
                r.AssociatedElementId.Value,
                r.AssociatedElementType,
                r.AssociatedElementName,
                r.SelectionRules.Where(s => s.SelectedOption is not null).Select(s => new MagicSelection(s.Name, s.SelectedOption!.Value)).ToList())).ToList(),
            classes.Classes.Select(c => new MagicClass(c.Registration.Value, c.Name, c.Level)).ToList(),
            Math.Max(1, classes.CalculateCharacterLevel()),
            Statistic("proficiency") ?? 2,
            ability => abilities.FirstOrDefault(a => string.Equals(a.Name, ability, StringComparison.OrdinalIgnoreCase))?.CalculatedModifier ?? 0,
            Statistic,
            character.RestrictedSources.ToList());

        var magic = await _spells.GetElementMagicAsync(input.Registrations.Select(r => r.ElementId).Distinct().ToList(), ct);
        await Send.OkAsync(SpellcastingFacts.Build(input, magic, await _spells.GetAsync(ct)), ct);
    }
}

/// <summary>The character's prepared spells and spent slots.</summary>
public sealed class GetCharacterMagicEndpoint : EndpointWithoutRequest<CharacterMagic>
{
    private readonly IPersistence _persistence;

    public GetCharacterMagicEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/magic");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        await Send.OkAsync(character.Magic, ct);
    }
}

/// <summary>Replaces the prepared spells and spent slots (the rules do not depend on them, so nothing is reprocessed).</summary>
public sealed class UpdateCharacterMagicEndpoint : Endpoint<CharacterMagic>
{
    private readonly IPersistence _persistence;

    public UpdateCharacterMagicEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/magic");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CharacterMagic req, CancellationToken ct)
    {
        if (req.Validate() is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        character.UpdateMagic(req with { Version = 1 });
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(character.Magic, ct);
    }
}
