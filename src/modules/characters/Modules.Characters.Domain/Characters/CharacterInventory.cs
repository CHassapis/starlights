namespace Starlights.Modules.Characters.Domain.Characters;

/// <summary>
/// One entry in a character's inventory, like Aurora's &lt;item&gt;: an item element, or a homebrew item described
/// by the player; how many; where it is (equipped, carried, in a container, stored away); attunement and charges.
/// </summary>
public sealed record InventoryItem
{
    /// <summary>Stable id of this entry (two longswords are two entries when one is equipped).</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>The item element; null for a homebrew item described by <see cref="Custom"/>.</summary>
    public Guid? ElementId { get; init; }

    /// <summary>
    /// For a magic item made from another item ("Weapon, +1", "Flame Tongue"), the weapon or armor it is; its
    /// figures (damage, AC, weight) come from this base, its magic from the element.
    /// </summary>
    public Guid? BaseElementId { get; init; }

    /// <summary>The player's own name for it, if any (otherwise the element's, formatted with its base).</summary>
    public string? Name { get; init; }

    public int Quantity { get; init; } = 1;

    /// <summary>Where it is equipped ("Armor", "Main Hand", "Off Hand", "Two-Handed", "Worn"), or null.</summary>
    public string? Equipped { get; init; }

    /// <summary>The entry of the container it is in (a backpack, a Bag of Holding, a mount); null when on the person.</summary>
    public string? ContainerId { get; init; }

    /// <summary>Left somewhere (at home, in a vault): not carried, its weight does not count.</summary>
    public bool Stored { get; init; }

    public bool Attuned { get; init; }

    /// <summary>Charges spent, for items with charges.</summary>
    public int ChargesUsed { get; init; }

    /// <summary>Whether the sheet prints a card for it (Aurora's "card" option).</summary>
    public bool Card { get; init; } = true;

    public string? Notes { get; init; }

    /// <summary>A homebrew item's details (or overrides for an element's).</summary>
    public CustomItem? Custom { get; init; }

    /// <summary>
    /// Set by the server: the rules registration of this item while it is active (equipped, or attuned when it
    /// needs attunement) and its element has rules; the client's value is ignored.
    /// </summary>
    public Guid? RegistrationId { get; init; }
}

/// <summary>What a player tells about a homebrew item.</summary>
public sealed record CustomItem
{
    public string? Category { get; init; }
    public decimal? Weight { get; init; }
    public string? Description { get; init; }
    public bool Magic { get; init; }
    public string? Rarity { get; init; }
    public bool Attunement { get; init; }

    /// <summary>It holds other items (a chest at home, a wagon).</summary>
    public bool Container { get; init; }
    public decimal? Capacity { get; init; }
}

/// <summary>
/// Everything a character has: items, coins, and the free-text treasure and quest item lists of the sheet's
/// equipment page.
/// </summary>
public sealed record CharacterInventory
{
    public int Version { get; init; } = 1;

    public List<InventoryItem> Items { get; init; } = [];

    /// <summary>Coins by kind: cp, sp, ep, gp, pp.</summary>
    public Dictionary<string, int> Coins { get; init; } = [];

    public string? Treasure { get; init; }

    public string? QuestItems { get; init; }

    public static readonly IReadOnlySet<string> CoinKinds = new HashSet<string> { "cp", "sp", "ep", "gp", "pp" };

    /// <summary>What is wrong with this inventory, or null: sizes, and containers that exist and do not nest in a loop.</summary>
    public string? Validate()
    {
        if (Items.Count > 1000)
        {
            return "At most 1,000 items.";
        }
        if (Items.Select(i => i.Id).Distinct().Count() != Items.Count)
        {
            return "Two items have the same id.";
        }
        foreach (var i in Items)
        {
            if (i.Id.Length is 0 or > 64)
            {
                return "An item has no id.";
            }
            if (i.ElementId is null && string.IsNullOrWhiteSpace(i.Name))
            {
                return "A homebrew item needs a name.";
            }
            if ((i.Name?.Length ?? 0) > 200 || (i.Notes?.Length ?? 0) > 5_000 || (i.Equipped?.Length ?? 0) > 40
                || i.Quantity is < 0 or > 100_000 || i.ChargesUsed is < 0 or > 1_000
                || (i.Custom is { } c && ((c.Category?.Length ?? 0) > 100 || (c.Description?.Length ?? 0) > 20_000 || (c.Rarity?.Length ?? 0) > 40
                    || c.Weight is < 0 or > 100_000 || c.Capacity is < 0 or > 1_000_000)))
            {
                return $"\"{i.Name ?? "An item"}\" has a value that is too long or out of range.";
            }
        }
        if (Coins.Any(c => !CoinKinds.Contains(c.Key) || c.Value is < 0 or > 1_000_000_000))
        {
            return "Coins are cp, sp, ep, gp and pp, each from 0 to 1,000,000,000.";
        }
        if ((Treasure?.Length ?? 0) > 20_000 || (QuestItems?.Length ?? 0) > 20_000)
        {
            return "The treasure and quest item texts are too long.";
        }

        // every container reference points at another entry, and following them never comes back around
        var containerOf = Items.ToDictionary(i => i.Id, i => i.ContainerId);
        foreach (var item in Items.Where(i => i.ContainerId is not null))
        {
            if (!containerOf.ContainsKey(item.ContainerId!))
            {
                return "An item is in a container that is not in the inventory.";
            }
            var seen = new HashSet<string> { item.Id };
            for (var at = item.ContainerId; at is not null; at = containerOf.GetValueOrDefault(at))
            {
                if (!seen.Add(at))
                {
                    return "Containers cannot be inside themselves.";
                }
            }
        }
        return null;
    }
}

/// <summary>
/// A build option added to the character outside the normal build (Aurora's "additional" options: an extra feat,
/// language, proficiency or spell, an optional class feature, a speed or vision bonus): its element and the
/// rules registration it made.
/// </summary>
public sealed record CharacterExtra
{
    public string Id { get; init; } = string.Empty;

    public Guid ElementId { get; init; }

    /// <summary>Set by the server: the registration that applies the extra's rules.</summary>
    public Guid? RegistrationId { get; init; }
}

/// <summary>
/// The character's day-to-day magic: which spells are prepared (per spellcasting, e.g. "Cleric") and which slots
/// are spent. What can be prepared, and how many, comes from the rules; this only holds the player's choices.
/// </summary>
public sealed record CharacterMagic
{
    public int Version { get; init; } = 1;

    /// <summary>Prepared spell elements per spellcasting name; always-prepared spells are not listed.</summary>
    public Dictionary<string, List<Guid>> Prepared { get; init; } = [];

    /// <summary>Spent spell slots per spell level (shared by all spellcasting classes).</summary>
    public Dictionary<int, int> ExpendedSlots { get; init; } = [];

    /// <summary>Spent pact magic slots (warlock).</summary>
    public int ExpendedPactSlots { get; init; }

    /// <summary>
    /// What is wrong with the magic, or null when it is fine. Prepared spells that no longer fit the rules (a level
    /// lost, a book switched off) are kept, like a builder pick: the Magic tab shows them for the player to change.
    /// </summary>
    public string? Validate()
    {
        if (Prepared.Count > 20 || Prepared.Any(p => p.Key.Length is 0 or > 100 || p.Value.Count > 500))
        {
            return "At most 20 spellcastings with 500 prepared spells each.";
        }
        if (ExpendedSlots.Any(s => s.Key is < 1 or > 9 || s.Value is < 0 or > 99) || ExpendedPactSlots is < 0 or > 99)
        {
            return "Spent slots are for spell levels 1 to 9, from 0 to 99 each.";
        }
        return null;
    }
}
