using Starlights.Platform.Domain;

namespace Starlights.Modules.Characters.Domain.Characters;

/// <summary>
/// A character as it was when its builder was opened: nothing changed in the builder is kept for good until the player
/// saves (the snapshot is dropped) or discards (the character is put back as it was). Its id is the character's.
/// </summary>
public sealed class CharacterSnapshot : EntityBase<Guid>
{
    private CharacterSnapshot(Guid id, string data, DateTimeOffset takenAt)
        : base(id)
    {
        Data = data;
        TakenAt = takenAt;
    }

    /// <summary>The character's rows as JSON (see ICharacterSnapshotsRepository).</summary>
    public string Data { get; private set; }

    public DateTimeOffset TakenAt { get; private set; }

    public static CharacterSnapshot Take(Guid characterId, string data) => new(characterId, data, DateTimeOffset.UtcNow);
}
