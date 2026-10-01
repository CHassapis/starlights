namespace Starlights.Modules.Elements.Integration;

/// <summary>
/// Every item of the content (Aurora's Item, Weapon, Armor and Magic Item elements) described for the inventory:
/// what it is (several categories at once, e.g. a Flame Tongue is both Weapons and Magic Weapons), its magic
/// layer, the base item a magic item is made from, weapon, armor and container figures, and what it does.
/// </summary>
public interface IItemCatalog
{
    Task<ItemCatalogSnapshot> GetAsync(CancellationToken cancellationToken = default);

    /// <summary>The weapons or armor a magic item such as "Weapon, +1" or "Flame Tongue" can be made from.</summary>
    Task<List<ItemInfo>> GetBaseCandidatesAsync(Guid magicItemId, CancellationToken cancellationToken = default);
}

/// <summary>The catalog at one content version (bumped by every import, update or homebrew change).</summary>
public sealed record ItemCatalogSnapshot(long Version, IReadOnlyList<ItemInfo> Items)
{
    private readonly Dictionary<Guid, ItemInfo> _byId = Items.ToDictionary(i => i.Id);

    public ItemInfo? Find(Guid id) => _byId.GetValueOrDefault(id);
}

public sealed record ItemInfo
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }

    /// <summary>The Aurora element type: Item, Weapon, Armor or Magic Item.</summary>
    public required string ElementType { get; init; }

    public string? Source { get; init; }
    public required string AuroraId { get; init; }

    /// <summary>
    /// What the item is, in Aurora's compendium categories (Adventuring Gear, Weapons, Magic Weapons, Rings,
    /// Spell Scrolls, …); an item is often several.
    /// </summary>
    public required IReadOnlyList<string> Categories { get; init; }

    /// <summary>Rarity, attunement, charges and enhancement of a magic item; null for mundane items.</summary>
    public MagicInfo? Magic { get; init; }

    /// <summary>
    /// A build option rather than gear (Aurora's Optional Class Features, Additional Feature and Additional Ability
    /// Score Improvement "items" grant features); offered by the extras flow, never in the item picker.
    /// </summary>
    public bool BuildOption { get; init; }

    /// <summary>Aurora hides it from the inventory (companion selections and the like).</summary>
    public bool Hidden { get; init; }

    /// <summary>Weight in pounds of one.</summary>
    public decimal Weight { get; init; }

    /// <summary>Does not count toward what the character carries (mounts, vehicles, saddlebags).</summary>
    public bool ExcludeEncumbrance { get; init; }

    public decimal? Cost { get; init; }
    public string? Currency { get; init; }
    public bool Stackable { get; init; }

    /// <summary>A gem, art object or trade good (Aurora's "valuable").</summary>
    public bool Valuable { get; init; }

    /// <summary>Where Aurora says it is worn or held: onehand, twohand, body, ring, head, neck, …</summary>
    public string? Slot { get; init; }

    public WeaponInfo? Weapon { get; init; }
    public ArmorInfo? Armor { get; init; }

    /// <summary>For a magic item made from another item: which weapons or armor qualify.</summary>
    public BaseItemInfo? Base { get; init; }

    public ContainerInfo? Container { get; init; }

    /// <summary>The element has rules (grant, select or stat): while active it is registered with the character.</summary>
    public bool HasRules { get; init; }

    /// <summary>What it does, in words: "+1 AC", "+1 to all saving throws", "You can cast Fireball", …</summary>
    public IReadOnlyList<string> Effects { get; init; } = [];
}

public sealed record MagicInfo(string? Rarity, bool Attunement, string? AttunementBy, int? Charges, bool Cursed, int? Enhancement);

public sealed record WeaponInfo(
    string Damage,
    string? DamageType,
    string? Versatile,
    string? Range,
    IReadOnlyList<string> Properties,
    bool Martial,
    bool Ranged,
    string? ProficiencyId,
    string? AmmunitionId,
    string? Mastery = null);

/// <summary>Kind is Light, Medium, Heavy or Shield; ArmorClass is the base AC (the bonus for a shield).</summary>
public sealed record ArmorInfo(string Kind, int ArmorClass, int? StrengthRequirement, bool StealthDisadvantage, string? ProficiencyId);

/// <summary>Kind is Weapon or Armor; Rule is Aurora's setter (an item name or an ID_… supports expression).</summary>
public sealed record BaseItemInfo(string Kind, string Rule, string? NameFormat);

/// <summary>CapacityLb is what it holds; Weightless (Bag of Holding): contents add no weight; Detached: a mount or
/// vehicle, its contents are not on the character.</summary>
public sealed record ContainerInfo(decimal? CapacityLb, bool Weightless, bool Detached);
