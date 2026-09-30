using Starlights.Modules.Characters.Domain.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Data;

public interface IPlayersRepository : IRepository
{
    void Add(Player player);

    /// <summary>
    /// Finds a player by name (case-insensitive).
    /// </summary>
    Task<Player?> GetPlayerAsync(string name);

    /// <summary>
    /// The names of the players that locked their characters with a password.
    /// </summary>
    Task<List<string>> GetLockedPlayerNamesAsync();

    /// <summary>
    /// The player a character is filed under, without loading the character ("" when unassigned, null when missing).
    /// </summary>
    Task<string?> GetCharacterPlayerNameAsync(Guid characterId);
}
