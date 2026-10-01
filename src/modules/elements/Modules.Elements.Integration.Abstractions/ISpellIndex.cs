namespace Starlights.Modules.Elements.Integration;

/// <summary>
/// Every spell of the content with what the builder, the Magic tab and the sheet need: level, school, the class
/// lists it is on (Aurora's supports), ritual and concentration, and its casting figures.
/// </summary>
public interface ISpellIndex
{
    Task<SpellIndexSnapshot> GetAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// How the given elements cast spells, as Aurora's &lt;spellcasting&gt; says (a class's or a subclass's).
    /// </summary>
    Task<IReadOnlyList<SpellcastingDefinition>> GetSpellcastingAsync(IReadOnlyCollection<Guid> elementIds, CancellationToken cancellationToken = default);

    /// <summary>The spellcasting a spell selection belongs to (Aurora's select spellcasting="Cleric"), if any.</summary>
    Task<string?> GetSelectSpellcastingAsync(Guid elementId, string selectName, CancellationToken cancellationToken = default);

    /// <summary>
    /// The spells a selection offers once its placeholders are filled in for a character: $(spellcasting:list) is
    /// the character's lists for that spellcasting, $(spellcasting:slots) the spell levels it has slots for, and a
    /// number is a spell level.
    /// </summary>
    Task<List<SpellInfo>> GetSpellOptionsAsync(string supports, IReadOnlyCollection<string> lists, IReadOnlyCollection<int> slotLevels, CancellationToken cancellationToken = default);

    /// <summary>
    /// What the given elements say about magic: their spellcasting, how they count for multiclass spell slots, the
    /// spells they grant or let you choose (with Aurora's spellcasting and prepared attributes, which the rules
    /// engine does not keep) and their spellcasting statistics by level.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, ElementMagic>> GetElementMagicAsync(IReadOnlyCollection<Guid> elementIds, CancellationToken cancellationToken = default);
}

/// <summary>
/// The magic an element's Aurora XML describes (see <see cref="ISpellIndex.GetElementMagicAsync"/>), and the Aurora
/// conditions it grants (damage resistances and the like, built into Aurora rather than its data, so not elements).
/// </summary>
public sealed record ElementMagic(
    Guid ElementId,
    string Name,
    string? Source,
    SpellcastingDefinition? Spellcasting,
    MulticlassSlots? Multiclass,
    IReadOnlyList<SpellGrant> Grants,
    IReadOnlyList<SpellSelect> Selects,
    IReadOnlyList<SpellcastingStat> Stats,
    IReadOnlyList<string>? Conditions = null);

/// <summary>
/// How a spellcasting class's levels count toward the shared multiclass spell slots (Aurora's
/// ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_*): all of them, half, half rounded up (artificer), a third, or
/// not at all (Solo: warlock pact magic keeps its own slots).
/// </summary>
public enum MulticlassSlots
{
    Full,
    Half,
    HalfUp,
    Third,
    Solo,
}

/// <summary>A &lt;grant type="Spell"&gt;: the spell's Aurora id, the spellcasting it counts for, whether it is always prepared.</summary>
public sealed record SpellGrant(string AuroraId, string? Spellcasting, bool Prepared, int? Level);

/// <summary>A &lt;select type="Spell"&gt;: its name, the spellcasting it counts for, whether picks are always prepared.</summary>
public sealed record SpellSelect(string Name, string? Spellcasting, bool Prepared, int? Level, int Number);

/// <summary>A &lt;stat&gt; about spellcasting ("cleric:spellcasting:prepare"), with the class level it applies from.</summary>
public sealed record SpellcastingStat(string Name, string Value, int? Level);

public sealed record SpellIndexSnapshot(long Version, IReadOnlyList<SpellInfo> Spells)
{
    private readonly Dictionary<Guid, SpellInfo> _byId = Spells.ToDictionary(s => s.Id);

    public SpellInfo? Find(Guid id) => _byId.GetValueOrDefault(id);
}

public sealed record SpellInfo
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }
    public required string AuroraId { get; init; }
    public string? Source { get; init; }
    public int Level { get; init; }
    public string? School { get; init; }

    /// <summary>The spell lists it is on, as Aurora's supports: class names and the like ("Cleric", "Wizard").</summary>
    public IReadOnlyList<string> Lists { get; init; } = [];

    public bool Ritual { get; init; }
    public bool Concentration { get; init; }
    public string? CastingTime { get; init; }
    public string? Range { get; init; }
    public string? Duration { get; init; }
    public string? Components { get; init; }
}

/// <summary>
/// Aurora's &lt;spellcasting&gt;: its name (usually the class), the ability, whether spells are prepared, whether the
/// whole list is known (clerics, druids: <c>&lt;list known="true"&gt;</c>), whether known spells can be swapped on level up
/// (<c>allowReplace</c>: sorcerers, warlocks, bards), the lists it draws from and, for an extending element
/// (<c>extend="true"</c>, e.g. Magical Secrets), the lists it adds.
/// </summary>
public sealed record SpellcastingDefinition(
    Guid ElementId,
    string Name,
    string? Ability,
    bool Prepare,
    bool KnowsWholeList,
    bool AllowReplace,
    bool Extend,
    IReadOnlyList<string> Lists,
    IReadOnlyList<string> Extends);
