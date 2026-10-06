namespace Starlights.Modules.Characters.Domain.Characters;

/// <summary>
/// The character's state in a fight, kept between visits to the Battle Action Simulator: hit points lost and
/// temporary hit points, hit dice and limited-use features spent, concentration, conditions and death saves.
/// What the character can do comes from the rules; this only holds what has happened to it. Spent spell slots stay
/// in <see cref="CharacterMagic"/>, shared with the Magic tab.
/// </summary>
public sealed record CharacterCombat
{
    public int Version { get; init; } = 1;

    /// <summary>Hit points lost from the maximum (kept as a wound, so a new maximum after a level-up still applies).</summary>
    public int Damage { get; init; }

    public int TemporaryHitPoints { get; init; }

    /// <summary>
    /// The maximum hit points the simulator worked out last time (with what changes them now, Aid or exhaustion),
    /// kept so a DM's fight board can show current and maximum hit points. Null until the simulator has been opened.
    /// </summary>
    public int? MaxHitPoints { get; init; }

    /// <summary>Hit dice spent on short rests.</summary>
    public int HitDiceSpent { get; init; }

    /// <summary>Uses spent of each limited-use feature, by its name on the sheet.</summary>
    public Dictionary<string, int> Uses { get; init; } = [];

    /// <summary>The spell being concentrated on, if any.</summary>
    public string? Concentration { get; init; }

    public List<string> Conditions { get; init; } = [];

    public int Exhaustion { get; init; }

    public int DeathSaveSuccesses { get; init; }

    public int DeathSaveFailures { get; init; }

    public bool HeroicInspiration { get; init; }

    /// <summary>Item powers switched on ("&lt;inventory entry id&gt;:extra", a Flame Tongue set ablaze).</summary>
    public List<string> Active { get; init; } = [];

    /// <summary>Spells, features and situations affecting the character ("Shield", "Bladesong", "Aid@3").</summary>
    public List<string> Effects { get; init; } = [];

    /// <summary>Familiars, companions, steeds and summons in the fight, each with its own hit points.</summary>
    public List<CharacterCompanion> Companions { get; init; } = [];

    /// <summary>What is wrong with the state, or null when it is fine.</summary>
    public string? Validate()
    {
        if (Damage is < 0 or > 100_000 || TemporaryHitPoints is < 0 or > 100_000 || HitDiceSpent is < 0 or > 100 || MaxHitPoints is < 0 or > 100_000)
        {
            return "Damage, temporary hit points and hit dice spent must be zero or more (and not absurdly large).";
        }
        if (Uses.Count > 300 || Uses.Any(u => u.Key.Length is 0 or > 200 || u.Value is < 0 or > 999))
        {
            return "At most 300 features, each with 0 to 999 uses spent.";
        }
        if (Concentration is { Length: > 200 } || Conditions.Count > 30 || Conditions.Any(c => c.Length is 0 or > 60))
        {
            return "At most 30 conditions, each a short name.";
        }
        if (Effects.Count > 50 || Effects.Any(e => e.Length is 0 or > 100))
        {
            return "At most 50 effects, each a short name.";
        }
        if (Active.Count > 50 || Active.Any(a => a.Length is 0 or > 200))
        {
            return "At most 50 item powers switched on.";
        }
        if (Companions.Count > 12 || Companions.Any(c => c.Validate() is not null))
        {
            return Companions.Select(c => c.Validate()).FirstOrDefault(p => p is not null) ?? "At most 12 companions.";
        }
        if (Exhaustion is < 0 or > 10 || DeathSaveSuccesses is < 0 or > 3 || DeathSaveFailures is < 0 or > 3)
        {
            return "Exhaustion is 0 to 10; death saves 0 to 3 each.";
        }
        return null;
    }
}

/// <summary>A familiar, companion or summoned creature: a creature from the Compendium of Lore (or one named by hand).</summary>
public sealed record CharacterCompanion
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary>The creature's entry in the Compendium of Lore's bestiary, when it has one.</summary>
    public string? Key { get; init; }

    public int MaxHitPoints { get; init; }

    public int Damage { get; init; }

    public int TemporaryHitPoints { get; init; }

    public string? Notes { get; init; }

    public string? Validate()
    {
        if (Id.Length is 0 or > 64 || Name.Length is 0 or > 100 || Key is { Length: > 200 } || Notes is { Length: > 2000 })
        {
            return "A companion needs an id and a name (up to 100 characters); notes up to 2000.";
        }
        return MaxHitPoints is < 0 or > 10_000 || Damage is < 0 or > 10_000 || TemporaryHitPoints is < 0 or > 10_000
            ? "A companion's hit points must be between 0 and 10000."
            : null;
    }
}

