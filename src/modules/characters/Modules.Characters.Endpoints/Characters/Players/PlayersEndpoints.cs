using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Players;

public sealed record PlayerModel(string Name, int Characters);

public sealed record GetPlayersResponse(List<PlayerModel> Players);

/// <summary>
/// The players that have characters, for the "who's playing?" picker. There are no accounts: a player is
/// just the name characters are filed under.
/// </summary>
public sealed class GetPlayersEndpoint : EndpointWithoutRequest<GetPlayersResponse>
{
    private readonly IPersistence _persistence;

    public GetPlayersEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("players");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var characters = await _persistence.GetRepository<ICharactersRepository>().GetCharactersAsync();

        var players = characters
            .Where(c => !string.IsNullOrWhiteSpace(c.PlayerName))
            .GroupBy(c => c.PlayerName, StringComparer.OrdinalIgnoreCase)
            .Select(g => new PlayerModel(g.First().PlayerName, g.Count()))
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        await Send.OkAsync(new GetPlayersResponse(players), ct);
    }
}

public sealed record AssignPlayerRequest
{
    public string PlayerName { get; init; } = string.Empty;
}

/// <summary>
/// Moves a character to another player.
/// </summary>
public sealed class AssignPlayerEndpoint : Endpoint<AssignPlayerRequest>
{
    private readonly IPersistence _persistence;

    public AssignPlayerEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/player");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(AssignPlayerRequest req, CancellationToken ct)
    {
        var characterId = new CharacterId(Route<Guid>("characterId"));

        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(characterId);
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        if (req.PlayerName.Trim().Length > 64)
        {
            AddError(r => r.PlayerName, "A player name can be at most 64 characters.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        character.AssignPlayer(req.PlayerName);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
