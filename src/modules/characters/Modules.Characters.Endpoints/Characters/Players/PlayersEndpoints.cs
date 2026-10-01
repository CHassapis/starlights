using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Players;

public sealed record PlayerModel(string Name, int Characters, bool Locked);

public sealed record GetPlayersResponse(List<PlayerModel> Players);

/// <summary>
/// The players, for the "who's playing?" picker. There are no accounts: a player is the name characters are
/// filed under, optionally locked with a password. Locked players' character counts are not given away.
/// </summary>
public sealed class GetPlayersEndpoint : EndpointWithoutRequest<GetPlayersResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public GetPlayersEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
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
        var locked = await _access.GetLockedPlayersAsync();
        var tokens = HttpContext.Request.Headers[PlayerAccess.TokenHeader].ToString();

        var counts = characters
            .Where(c => !string.IsNullOrWhiteSpace(c.PlayerName))
            .GroupBy(c => c.PlayerName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.First().PlayerName, g => g.Count(), StringComparer.OrdinalIgnoreCase);
        foreach (var name in locked.Where(n => !counts.ContainsKey(n)))
        {
            counts[name] = 0;
        }

        var players = counts
            .Select(p =>
            {
                var isLocked = locked.Contains(p.Key);
                return new PlayerModel(p.Key, isLocked && !_access.HasToken(tokens, p.Key) ? 0 : p.Value, isLocked);
            })
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        await Send.OkAsync(new GetPlayersResponse(players), ct);
    }
}

public sealed record UnlockPlayerRequest
{
    public string Name { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public sealed record UnlockPlayerResponse(string Name, string Token);

/// <summary>
/// Checks a locked player's password and returns the token that opens their characters.
/// </summary>
public sealed class UnlockPlayerEndpoint : Endpoint<UnlockPlayerRequest, UnlockPlayerResponse>
{
    private readonly PlayerAccess _access;

    public UnlockPlayerEndpoint(PlayerAccess access)
    {
        _access = access;
    }

    public override void Configure()
    {
        Post("players/unlock");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(UnlockPlayerRequest req, CancellationToken ct)
    {
        var token = await _access.UnlockAsync(req.Name, req.Password);
        if (token is null)
        {
            // a small delay makes guessing slower
            await Task.Delay(750, ct);
            await Send.UnauthorizedAsync(ct);
            return;
        }

        await Send.OkAsync(new UnlockPlayerResponse(req.Name.Trim(), token), ct);
    }
}

public sealed record SetPlayerPasswordRequest
{
    public string Name { get; init; } = string.Empty;

    /// <summary>The new password; empty removes the lock.</summary>
    public string Password { get; init; } = string.Empty;
}

/// <summary>
/// Locks a player's characters with a password, changes it, or (empty password) removes it. Changing or
/// removing needs the player's current token.
/// </summary>
public sealed class SetPlayerPasswordEndpoint : Endpoint<SetPlayerPasswordRequest, UnlockPlayerResponse>
{
    private readonly PlayerAccess _access;

    public SetPlayerPasswordEndpoint(PlayerAccess access)
    {
        _access = access;
    }

    public override void Configure()
    {
        Put("players/password");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SetPlayerPasswordRequest req, CancellationToken ct)
    {
        var name = req.Name.Trim();
        if (PlayerAccess.IsReservedName(name))
        {
            AddError(r => r.Name, "Player names cannot start with * or #.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (name.Length is 0 or > 64 || (req.Password.Length > 0 && req.Password.Length < 6))
        {
            AddError("Give the player name and a password of at least 6 characters.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        if (await _access.IsLockedAsync(name) && !_access.HasToken(HttpContext.Request.Headers[PlayerAccess.TokenHeader], name))
        {
            await Send.UnauthorizedAsync(ct);
            return;
        }

        var stored = await _access.SetPasswordAsync(name, req.Password);
        await Send.OkAsync(new UnlockPlayerResponse(stored, req.Password.Length > 0 ? _access.IssueToken(stored) : string.Empty), ct);
    }
}

public sealed record AssignPlayerRequest
{
    public string PlayerName { get; init; } = string.Empty;
}

/// <summary>
/// Moves a character to another player (a locked player only with their token).
/// </summary>
public sealed class AssignPlayerEndpoint : Endpoint<AssignPlayerRequest>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public AssignPlayerEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
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

        if (req.PlayerName.Trim().Length > 64 || PlayerAccess.IsReservedName(req.PlayerName))
        {
            AddError(r => r.PlayerName, "A player name can be at most 64 characters.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        if (await _access.IsLockedAsync(req.PlayerName) && !_access.HasToken(HttpContext.Request.Headers[PlayerAccess.TokenHeader], req.PlayerName))
        {
            await Send.UnauthorizedAsync(ct);
            return;
        }

        character.AssignPlayer(req.PlayerName);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
