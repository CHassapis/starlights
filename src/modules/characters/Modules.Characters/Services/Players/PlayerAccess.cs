using System.Security.Cryptography;
using System.Text;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Services.Players;

/// <summary>
/// Key for signing unlock tokens. Unset means a random key per process (unlocks last until a restart).
/// </summary>
public sealed record PlayerAccessOptions(string TokenKey);

/// <summary>
/// Optional per-player passwords. Unlocking returns a token the browser sends back in the X-Player-Token header
/// (comma-separated when it unlocked several players); the characters of a locked player need a valid one.
/// </summary>
public sealed class PlayerAccess
{
    public const string TokenHeader = "X-Player-Token";

    private static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(180);
    private const int Iterations = 210_000;

    private readonly IPersistence _persistence;
    private readonly byte[] _key;

    public PlayerAccess(IPersistence persistence, PlayerAccessOptions options)
    {
        _persistence = persistence;
        _key = string.IsNullOrEmpty(options.TokenKey) ? ProcessKey : Encoding.UTF8.GetBytes(options.TokenKey);
    }

    private static readonly byte[] ProcessKey = RandomNumberGenerator.GetBytes(32);

    private IPlayersRepository Players => _persistence.GetRepository<IPlayersRepository>();

    public async Task<bool> IsLockedAsync(string playerName) =>
        !string.IsNullOrWhiteSpace(playerName) && (await Players.GetPlayerAsync(playerName))?.PasswordHash is not null;

    public async Task<HashSet<string>> GetLockedPlayersAsync() =>
        new(await Players.GetLockedPlayerNamesAsync(), StringComparer.OrdinalIgnoreCase);

    public Task<string?> GetCharacterPlayerAsync(Guid characterId) => Players.GetCharacterPlayerNameAsync(characterId);

    /// <summary>
    /// Checks the password and returns an unlock token, or null when it is wrong or the player is not locked.
    /// </summary>
    public async Task<string?> UnlockAsync(string playerName, string password)
    {
        var player = await Players.GetPlayerAsync(playerName);
        if (player?.PasswordHash is null || !Verify(password, player.PasswordHash))
        {
            return null;
        }

        return IssueToken(player.Name);
    }

    /// <summary>
    /// Sets the player's password (creating the player when needed), or removes it when empty. Returns the name
    /// as stored.
    /// </summary>
    public async Task<string> SetPasswordAsync(string playerName, string? password)
    {
        var player = await Players.GetPlayerAsync(playerName);
        if (player is null)
        {
            player = Player.Create(playerName);
            Players.Add(player);
        }

        player.SetPasswordHash(string.IsNullOrEmpty(password) ? null : Hash(password));
        await _persistence.SaveChangesAsync();
        return player.Name;
    }

    public string IssueToken(string playerName)
    {
        var expires = DateTimeOffset.UtcNow.Add(TokenLifetime).ToUnixTimeSeconds();
        var name = Convert.ToBase64String(Encoding.UTF8.GetBytes(playerName)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return $"{name}.{expires}.{Sign(playerName, expires)}";
    }

    /// <summary>
    /// Whether the header carries a valid, unexpired token for the player.
    /// </summary>
    public bool HasToken(string? tokensHeader, string playerName)
    {
        if (string.IsNullOrWhiteSpace(tokensHeader))
        {
            return false;
        }

        foreach (var token in tokensHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = token.Split('.');
            if (parts.Length != 3 || !long.TryParse(parts[1], out var expires) || expires < DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                continue;
            }

            string name;
            try
            {
                var b64 = parts[0].Replace('-', '+').Replace('_', '/');
                name = Encoding.UTF8.GetString(Convert.FromBase64String(b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '=')));
            }
            catch (FormatException)
            {
                continue;
            }

            if (string.Equals(name, playerName.Trim(), StringComparison.OrdinalIgnoreCase) &&
                CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(parts[2]), Encoding.ASCII.GetBytes(Sign(name, expires))))
            {
                return true;
            }
        }

        return false;
    }

    private string Sign(string playerName, long expires)
    {
        var mac = HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes($"{playerName.Trim().ToLowerInvariant()}|{expires}"));
        return Convert.ToBase64String(mac).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    private static bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations))
        {
            return false;
        }

        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(parts[2]), iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
