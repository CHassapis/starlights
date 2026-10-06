using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Abilities;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Classes;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Multiclass;

public sealed record MulticlassOption(Guid ElementId, string Name, string Source, string? Prerequisite, bool Eligible);

public sealed record MulticlassTaken(string ExtraId, Guid ElementId, string Name);

public sealed record MulticlassResponse(List<MulticlassTaken> Taken, List<MulticlassOption> Options);

public sealed record AddMulticlassRequest(Guid ElementId);

/// <summary>
/// Multiclassing: the classes a character can take as an additional class ("Fighter (multiclass)", imported from
/// each class's &lt;multiclass&gt;), whether it meets their prerequisites (ability scores), and the ones it has taken.
/// A taken multiclass is kept with the character's extras (hidden from the Extras list) and registered at the root:
/// it grants the class, which becomes an additional, non-primary class with its own level.
/// </summary>
public sealed class GetMulticlassEndpoint : EndpointWithoutRequest<MulticlassResponse>
{
    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;

    public GetMulticlassEndpoint(IPersistence persistence, IElementsModuleQueries elements)
    {
        _persistence = persistence;
        _elements = elements;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/multiclass");
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

        var options = await _elements.GetElementsByType("Multiclass");
        var byId = options.ToDictionary(o => o.Id);
        var registrations = await _persistence.GetRepository<IRegistrationRepository>().GetRegistrationsAsync(character.Id);
        var registered = registrations.Select(r => r.AssociatedElementId.Value).ToHashSet();
        var classNames = character.GetRequiredComponent<ClassComponent>().Classes.Select(c => c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var scores = character.GetRequiredComponent<AbilitiesComponent>().AbilityScores;
        int? Value(string name)
        {
            var ability = name switch { "str" => "Strength", "dex" => "Dexterity", "con" => "Constitution", "int" => "Intelligence", "wis" => "Wisdom", "cha" => "Charisma", _ => name };
            return scores.FirstOrDefault(a => string.Equals(a.Name, ability, StringComparison.OrdinalIgnoreCase))?.CalculatedScore;
        }

        var taken = character.Extras.Where(e => byId.ContainsKey(e.ElementId)).Select(e => new MulticlassTaken(e.Id, e.ElementId, byId[e.ElementId].Name)).ToList();
        var available = options
            // not a class the character already has
            .Where(o => !classNames.Contains(o.Name.Replace(" (multiclass)", string.Empty, StringComparison.Ordinal)))
            .Select(o => new MulticlassOption(o.Id, o.Name.Replace(" (multiclass)", string.Empty, StringComparison.Ordinal), o.Source, o.Prerequisite,
                string.IsNullOrWhiteSpace(o.PrerequisiteRequirements) || RequirementsExpression.Evaluate(o.PrerequisiteRequirements, registered.Contains, Value)))
            .OrderBy(o => o.Name, StringComparer.Ordinal).ThenBy(o => o.Source, StringComparer.Ordinal)
            .ToList();
        await Send.OkAsync(new MulticlassResponse(taken, available), ct);
    }
}

public sealed class AddMulticlassEndpoint : Endpoint<AddMulticlassRequest, MulticlassTaken>
{
    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public AddMulticlassEndpoint(IPersistence persistence, IElementsModuleQueries elements, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _elements = elements;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Post("{characterId:guid}/multiclass");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(AddMulticlassRequest req, CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var element = await _elements.GetElementWithRules(req.ElementId);
        if (element is not { Type: "Multiclass" })
        {
            AddError(r => r.ElementId, "That is not a class to multiclass into.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var className = element.Name.Replace(" (multiclass)", string.Empty, StringComparison.Ordinal);
        var classes = character.GetRequiredComponent<ClassComponent>();
        if (classes.Classes.Count == 0 || classes.Classes.Any(c => string.Equals(c.Name, className, StringComparison.OrdinalIgnoreCase)))
        {
            AddError(r => r.ElementId, classes.Classes.Count == 0 ? "Pick the character's first class in the Build tab." : $"The character already has {className} levels.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (classes.CalculateCharacterLevel() >= 20)
        {
            AddError("A character can't go above level 20.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var extra = new CharacterExtra { Id = Guid.NewGuid().ToString("N"), ElementId = req.ElementId };
        extra = extra with { RegistrationId = await _attached.SyncAsync(character.Id, null, req.ElementId, shouldExist: true) };
        character.UpdateExtras([.. character.Extras, extra]);
        await _persistence.SaveChangesAsync();
        await _processor.ReproccessRegistrations(character.Id);
        await Send.OkAsync(new MulticlassTaken(extra.Id, extra.ElementId, element.Name), ct);
    }
}

public sealed class RemoveMulticlassEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public RemoveMulticlassEndpoint(IPersistence persistence, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Delete("{characterId:guid}/multiclass/{extraId}");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        var extra = character?.Extras.FirstOrDefault(e => e.Id == Route<string>("extraId"));
        if (character is null || extra is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        if (extra.RegistrationId is { } registration)
        {
            await _attached.RemoveAsync(character.Id, registration);
        }
        character.UpdateExtras(character.Extras.Where(e => e.Id != extra.Id));
        await _persistence.SaveChangesAsync();
        await _processor.ReproccessRegistrations(character.Id);
        await Send.NoContentAsync(ct);
    }
}
