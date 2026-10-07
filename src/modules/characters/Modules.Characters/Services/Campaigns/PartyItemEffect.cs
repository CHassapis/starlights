using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Services.Campaigns;

/// <summary>
/// A magic item used on another member of the party (a potion administered, "you or a creature you touch regains
/// 2d8 hit points"): the healing or temporary hit points the user's simulator rolled, put into that character's fight
/// state. Only what the fight state holds; a bonus to a save or damage reduced for an ally stays rolled and shown.
/// </summary>
public static class PartyItemEffect
{
    public const string Heal = "heal";
    public const string TemporaryHitPoints = "tempHp";
    public const int MaxAmount = 1000;

    /// <summary>What is wrong with using an item from one character on another, or null when it is fine.</summary>
    public static string? Validate(Campaign campaign, Guid fromCharacterId, Guid toCharacterId, string? kind, int amount)
    {
        if (kind is not (Heal or TemporaryHitPoints))
        {
            return "An item can heal another character or give them temporary hit points.";
        }
        if (amount is < 1 or > MaxAmount)
        {
            return $"The amount must be 1 to {MaxAmount}.";
        }
        if (fromCharacterId == toCharacterId || !campaign.Party.Contains(fromCharacterId) || !campaign.Party.Contains(toCharacterId))
        {
            return "Use it on another character of this campaign's party.";
        }
        return null;
    }

    /// <summary>The other character's state with the effect, counted as a change from outside (see <see cref="CharacterCombat.Received"/>).</summary>
    public static CharacterCombat Apply(CharacterCombat target, string kind, int amount) =>
        (kind == Heal ? target.Healed(amount) : target.WithTemporaryHitPoints(amount)) with { Received = target.Received + 1 };
}
