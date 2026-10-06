using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Data;

public interface ICharactersRepository : IRepository
{
    /// <summary>
    /// Adds a new character to the repository.
    /// </summary>
    void Add(Character character);

    /// <summary>
    /// Retrieves a character by its identifier.
    /// </summary>
    /// <param name="identifier">The unique identifier of the character.</param>
    /// <returns>The character if found; otherwise, null.</returns>
    Task<Character?> GetCharacterAsync(Guid identifier);

    /// <summary>
    /// Retrieves all characters from the repository.
    /// </summary>
    Task<IEnumerable<Character>> GetCharactersAsync();

    /// <summary>
    /// Deletes a character by its identifier.
    /// </summary>
    Task<bool> DeleteCharacterAsync(CharacterId identifier);

    /// <summary>
    /// The characters' names and fight state (hit points lost, conditions…) without loading the rest of them, for a
    /// DM's fight board that refreshes every few seconds.
    /// </summary>
    Task<Dictionary<Guid, CharacterCombatState>> GetCombatStatesAsync(IReadOnlyCollection<Guid> characterIds);
}

public sealed record CharacterCombatState(Guid Id, string Name, CharacterCombat Combat);
