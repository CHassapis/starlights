using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Combat;

/// <summary>The character's state in a fight, for the Battle Action Simulator.</summary>
public sealed class GetCharacterCombatEndpoint : EndpointWithoutRequest<CharacterCombat>
{
    private readonly IPersistence _persistence;

    public GetCharacterCombatEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/combat");
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

        await Send.OkAsync(character.Combat, ct);
    }
}

/// <summary>
/// Replaces the character's state in a fight (the rules do not depend on it, so nothing is reprocessed). A state
/// loaded before someone else changed it (Received is behind) is refused with 409 and the current state, so a
/// simulator left open doesn't undo a party member's potion; Received itself is never taken from the request.
/// </summary>
public sealed class UpdateCharacterCombatEndpoint : Endpoint<CharacterCombat>
{
    private readonly IPersistence _persistence;

    public UpdateCharacterCombatEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/combat");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CharacterCombat req, CancellationToken ct)
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

        if (req.Received < character.Combat.Received)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status409Conflict;
            await HttpContext.Response.WriteAsJsonAsync(character.Combat, ct);
            return;
        }

        character.UpdateCombat(req with { Version = 1, Received = character.Combat.Received });
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(character.Combat, ct);
    }
}
