using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Data;

/// <summary>
/// Snapshots of characters for the builder's Save and Discard: everything the builder changes (name, sources, story,
/// equipment, extras, prepared spells, ability scores, classes, every choice and what it registered), not what
/// happens in a fight.
/// </summary>
public interface ICharacterSnapshotsRepository : IRepository
{
    Task<CharacterSnapshot?> GetAsync(Guid characterId);

    /// <summary>The character as it is now, as JSON (the same for the same character: rows in id order).</summary>
    Task<string> CaptureAsync(Guid characterId);

    /// <summary>Puts the character back as the captured JSON describes it (in one transaction).</summary>
    Task RestoreAsync(Guid characterId, string data);

    void Add(CharacterSnapshot snapshot);

    void Remove(CharacterSnapshot snapshot);
}
