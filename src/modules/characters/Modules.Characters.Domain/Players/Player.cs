using Starlights.Platform.Domain;

namespace Starlights.Modules.Characters.Domain.Players;

/// <summary>
/// A player: the name characters are filed under. There are no accounts; a player can optionally lock their
/// characters with a password.
/// </summary>
public sealed class Player : EntityBase<Guid>
{
    private Player(Guid id, string name)
        : base(id)
    {
        Name = name;
    }

    /// <summary>
    /// Gets the player's name, as characters are filed under it.
    /// </summary>
    public string Name { get; private set; }

    /// <summary>
    /// Gets the salted hash of the player's password, or null when the player is not locked.
    /// </summary>
    public string? PasswordHash { get; private set; }

    public static Player Create(string name) => new(Guid.CreateVersion7(), name.Trim());

    /// <summary>
    /// Sets (or with null removes) the password hash.
    /// </summary>
    public void SetPasswordHash(string? passwordHash) => PasswordHash = passwordHash;
}
