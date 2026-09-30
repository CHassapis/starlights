using System.Globalization;
using System.Text.RegularExpressions;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Characters.Services.Magic;

/// <summary>A registration as the magic rules need it: its place in the tree and the picks of its selections.</summary>
public sealed record MagicRegistration(Guid Id, Guid? ParentId, Guid ElementId, string Type, string Name, IReadOnlyList<MagicSelection> Selections);

/// <summary>A selection of a registration (Aurora's select name) and the element picked for it.</summary>
public sealed record MagicSelection(string Name, Guid Selected);

/// <summary>A character's class (the registration of its Class element) and its level in that class.</summary>
public sealed record MagicClass(Guid RegistrationId, string Name, int Level);

/// <summary>What the character is: the inputs <see cref="SpellcastingFacts.Build"/> reads.</summary>
public sealed record MagicCharacter(
    IReadOnlyList<MagicRegistration> Registrations,
    IReadOnlyList<MagicClass> Classes,
    int Level,
    int ProficiencyBonus,
    Func<string, int> AbilityModifier,
    Func<string, int?> Statistic,
    IReadOnlyCollection<string> RestrictedSources);

public sealed record SpellcastingFactsModel(int ProficiencyBonus, List<CasterFacts> Casters, List<KnownSpell> OtherSpells);

/// <summary>
/// One spellcasting ("Cleric", "Wizard", "Dead Three"): its ability and figures, how it prepares spells, the slots
/// of its own class table, its spells, and what it may prepare.
/// </summary>
public sealed record CasterFacts
{
    public required string Name { get; init; }
    public string? Ability { get; init; }
    public int AbilityModifier { get; init; }
    public int Attack { get; init; }
    public int Dc { get; init; }

    /// <summary>What items and features add on top of proficiency and the ability (Rod of the Pact Keeper, Robe of the Archmagi).</summary>
    public int AttackBonus { get; init; }

    public int DcBonus { get; init; }

    /// <summary>Prepares spells each day (clerics, druids, wizards) rather than knowing a fixed set.</summary>
    public bool Prepares { get; init; }

    /// <summary>Knows its whole class list and prepares from it (clerics, druids, artificers).</summary>
    public bool KnowsWholeList { get; init; }

    /// <summary>Prepares from the spells it has picked (a wizard's spellbook).</summary>
    public bool Spellbook => Prepares && !KnowsWholeList;

    /// <summary>May swap a known spell when it gains a level (sorcerers, warlocks, bards).</summary>
    public bool AllowReplace { get; init; }

    public IReadOnlyList<string> Lists { get; init; } = [];
    public string? ClassName { get; init; }
    public int ClassLevel { get; init; }

    /// <summary>How its levels count toward multiclass slots: Full, Half, HalfUp, Third, Solo, or null when it does not count.</summary>
    public string? Multiclass { get; init; }

    /// <summary>"2024" for the 2024 rules (half casters round up when multiclassing), else "2014".</summary>
    public string Edition { get; init; } = "2014";

    /// <summary>Slots by spell level from its own class table (the whole slots when it is the only spellcasting class).</summary>
    public Dictionary<int, int> Slots { get; init; } = [];

    /// <summary>Pact magic: slots of one level that come back on a short rest.</summary>
    public PactSlots? Pact { get; init; }

    public int? PrepareMax { get; init; }
    public List<KnownSpell> Spells { get; init; } = [];

    /// <summary>The spells it may prepare: its class list up to its highest slot, or its spellbook.</summary>
    public List<Guid> Preparable { get; init; } = [];

    public NextLevelFacts? NextLevel { get; init; }
}

/// <summary>
/// A spell the character has. Kind is "cantrip", "always" (always prepared: domain spells, and spells of the list
/// gained from a feat or species, as Aurora counts them), "spellbook" (may be prepared), or "known".
/// </summary>
public sealed record KnownSpell(Guid RegistrationId, Guid ElementId, string Name, int Level, string Kind, string Origin);

public sealed record PactSlots(int Level, int Count);

/// <summary>What the next level of the class adds to this spellcasting: slots, spells to prepare, new picks.</summary>
public sealed record NextLevelFacts(int Level, Dictionary<int, int> Slots, int Prepare, List<string> Choices);

/// <summary>
/// Works out a character's spellcasting from its registrations and what Aurora's XML says about them. Aurora's
/// placement is followed: a spell belongs to the spellcasting its grant or select names, else to the spellcasting
/// feature (or the class) it hangs under, else, for a level 1+ spell on the list of exactly one class that knows its
/// whole list, to that class as always prepared (Magic Initiate's Protection from Evil and Good under Cleric; a
/// wizard's or sorcerer's list does not take such spells in); the rest are other spells.
/// </summary>
public static partial class SpellcastingFacts
{
    private static readonly HashSet<string> Abilities = new(["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"], StringComparer.OrdinalIgnoreCase);

    public static SpellcastingFactsModel Build(MagicCharacter character, IReadOnlyDictionary<Guid, ElementMagic> magic, SpellIndexSnapshot spells)
    {
        var byId = character.Registrations.ToDictionary(r => r.Id);
        IEnumerable<MagicRegistration> Ancestors(MagicRegistration r)
        {
            for (var a = r.ParentId is { } p ? byId.GetValueOrDefault(p) : null; a is not null; a = a.ParentId is { } q ? byId.GetValueOrDefault(q) : null)
            {
                yield return a;
            }
        }

        // the spellcastings, in build order; extending elements (Magical Secrets) add lists to one of them
        var definitions = character.Registrations
            .Select(r => (Registration: r, Magic: magic.GetValueOrDefault(r.ElementId)))
            .Where(x => x.Magic?.Spellcasting is not null)
            .ToList();
        var casters = new List<(MagicRegistration Registration, ElementMagic Magic, CasterFacts Facts)>();
        foreach (var (registration, element) in definitions.Where(d => !d.Magic!.Spellcasting!.Extend))
        {
            var definition = element!.Spellcasting!;
            if (casters.Any(c => Same(c.Facts.Name, definition.Name)))
            {
                continue;
            }

            var slug = Slug(definition.Name);
            var modifier = definition.Ability is { } ability ? character.AbilityModifier(ability) : 0;
            var attackBonus = (character.Statistic($"{slug}:spellcasting:attack") ?? 0) + (character.Statistic("spellcasting:attack") ?? 0);
            var dcBonus = (character.Statistic($"{slug}:spellcasting:dc") ?? 0) + (character.Statistic("spellcasting:dc") ?? 0);
            var lists = definition.Lists
                .Concat(definitions.Where(d => d.Magic!.Spellcasting!.Extend && Same(d.Magic.Spellcasting.Name, definition.Name)).SelectMany(d => d.Magic!.Spellcasting!.Extends))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var slots = new Dictionary<int, int>();
            for (var level = 1; level <= 9; level++)
            {
                if (character.Statistic($"{slug}:spellcasting:slots:{level}") is > 0 and var n)
                {
                    slots[level] = n;
                }
            }
            PactSlots? pact = null;
            if ((element.Multiclass == MulticlassSlots.Solo || character.Statistic($"{slug}:spellcasting:slot") is not null) && slots.Count > 0)
            {
                var top = slots.Keys.Max();
                pact = new PactSlots(top, slots[top]);
                slots = [];
            }

            var owningClass = Ancestors(registration).Prepend(registration)
                .Select(a => character.Classes.FirstOrDefault(c => c.RegistrationId == a.Id))
                .FirstOrDefault(c => c is not null);
            var classLevel = owningClass?.Level ?? character.Level;

            casters.Add((registration, element, new CasterFacts
            {
                Name = definition.Name,
                Ability = definition.Ability,
                AbilityModifier = modifier,
                Attack = character.ProficiencyBonus + modifier + attackBonus,
                Dc = 8 + character.ProficiencyBonus + modifier + dcBonus,
                AttackBonus = attackBonus,
                DcBonus = dcBonus,
                Prepares = definition.Prepare,
                KnowsWholeList = definition.KnowsWholeList,
                AllowReplace = definition.AllowReplace,
                Lists = lists,
                ClassName = owningClass?.Name,
                ClassLevel = classLevel,
                Multiclass = element.Multiclass?.ToString(),
                Edition = element.Source?.Contains("2024", StringComparison.Ordinal) == true ? "2024" : "2014",
                Slots = slots,
                Pact = pact,
                PrepareMax = definition.Prepare ? character.Statistic($"{slug}:spellcasting:prepare") : null,
                NextLevel = NextLevel(element, slug, classLevel),
            }));
        }

        var other = new List<KnownSpell>();
        foreach (var registration in character.Registrations.Where(r => string.Equals(r.Type, "Spell", StringComparison.OrdinalIgnoreCase)))
        {
            if (spells.Find(registration.ElementId) is not { } spell)
            {
                continue;
            }
            var parent = registration.ParentId is { } p ? byId.GetValueOrDefault(p) : null;
            var parentMagic = parent is null ? null : magic.GetValueOrDefault(parent.ElementId);

            // what the grant or select that gave it says: its spellcasting, and whether it is always prepared
            string? named = null;
            var prepared = false;
            var picked = false;
            if (parent?.Selections.FirstOrDefault(s => s.Selected == registration.ElementId) is { } selection)
            {
                picked = true;
                var select = parentMagic?.Selects.FirstOrDefault(s => s.Name == selection.Name);
                (named, prepared) = (select?.Spellcasting, select?.Prepared ?? false);
            }
            else if (parentMagic?.Grants.FirstOrDefault(g => string.Equals(g.AuroraId, spell.AuroraId, StringComparison.OrdinalIgnoreCase)) is { } grant)
            {
                (named, prepared) = (grant.Spellcasting, grant.Prepared);
            }

            var owner = named is null ? null : casters.FirstOrDefault(c => Same(c.Facts.Name, named)).Facts;
            var own = owner is not null;
            if (owner is null && named is null)
            {
                // under a spellcasting feature, or under the class or subclass that has it; a feat is its own source
                foreach (var ancestor in Ancestors(registration))
                {
                    if (string.Equals(ancestor.Type, "Feat", StringComparison.OrdinalIgnoreCase))
                    {
                        break;
                    }
                    owner = casters.FirstOrDefault(c => c.Registration.Id == ancestor.Id).Facts;
                    if (owner is null && ancestor.Type is "Class" or "SubClass")
                    {
                        var under = casters.Where(c => Ancestors(c.Registration).Any(a => a.Id == ancestor.Id)).ToList();
                        owner = under.Count == 1 ? under[0].Facts : null;
                    }
                    if (owner is not null)
                    {
                        own = true;
                        break;
                    }
                }
            }
            if (owner is null && spell.Level >= 1)
            {
                // only a caster that knows its whole list takes it in (a wizard's or sorcerer's stays apart, as in Aurora)
                var onList = casters.Where(c => c.Facts.KnowsWholeList && c.Facts.Lists.Any(l => spell.Lists.Contains(l, StringComparer.OrdinalIgnoreCase))).ToList();
                owner = onList.Count == 1 ? onList[0].Facts : null;
            }

            var kind = spell.Level == 0 ? "cantrip"
                : prepared ? "always"
                : owner is null ? "known"
                : owner.Spellbook && own && picked ? "spellbook"
                : owner.Prepares ? "always"
                : "known";
            var known = new KnownSpell(registration.Id, registration.ElementId, spell.Name, spell.Level, kind, Origin(parent, parent?.ParentId is { } g ? byId.GetValueOrDefault(g) : null));
            (owner?.Spells ?? other).Add(known);
        }

        // what each preparing spellcasting may prepare: its lists up to its highest slot, or its spellbook
        foreach (var (_, _, facts) in casters.Where(c => c.Facts.Prepares))
        {
            if (facts.Spellbook)
            {
                facts.Preparable.AddRange(facts.Spells.Where(s => s.Kind == "spellbook").Select(s => s.ElementId).Distinct());
                continue;
            }
            var highest = facts.Pact?.Level ?? (facts.Slots.Count > 0 ? facts.Slots.Keys.Max() : 0);
            var always = facts.Spells.Where(s => s.Kind == "always").Select(s => s.ElementId).ToHashSet();
            var candidates = spells.Spells
                .Where(s => s.Level >= 1 && s.Level <= highest && !always.Contains(s.Id) && s.Lists.Any(l => facts.Lists.Contains(l, StringComparer.OrdinalIgnoreCase)))
                .ToList();
            // switched-off books are left out, unless that leaves nothing (the same rule as the builder's choices)
            var allowed = candidates.Where(s => s.Source is null || !character.RestrictedSources.Contains(s.Source)).ToList();
            facts.Preparable.AddRange((allowed.Count > 0 ? allowed : candidates).Select(s => s.Id));
        }

        foreach (var (_, _, facts) in casters)
        {
            facts.Spells.Sort(ByLevelThenName);
        }
        other.Sort(ByLevelThenName);
        return new SpellcastingFactsModel(character.ProficiencyBonus, casters.Select(c => c.Facts).ToList(), other);
    }

    /// <summary>Aurora's statistic name for a spellcasting: "Dead Three" is "dead-three".</summary>
    public static string Slug(string name) => name.Trim().ToLowerInvariant().Replace(' ', '-');

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static int ByLevelThenName(KnownSpell a, KnownSpell b) =>
        a.Level != b.Level ? a.Level.CompareTo(b.Level) : string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);

    /// <summary>Where a spell comes from, as Aurora labels it: "Domain Spells", "Wisdom (High Elf)".</summary>
    private static string Origin(MagicRegistration? parent, MagicRegistration? grandparent)
    {
        if (parent is null)
        {
            return string.Empty;
        }
        var name = LevelPrefix().Replace(parent.Name, string.Empty);
        // a bare ability or class name says little by itself: say what it belongs to
        return grandparent is not null && (Abilities.Contains(name) || !name.Contains(' ')) && parent.Type is not ("Class" or "SubClass" or "Feat")
            ? $"{name} ({LevelPrefix().Replace(grandparent.Name, string.Empty)})"
            : name;
    }

    /// <summary>
    /// The numbers the spellcasting feature's own rules add at the next class level: slots and spells to prepare
    /// (plain numbers only), and the spell picks it opens.
    /// </summary>
    private static NextLevelFacts? NextLevel(ElementMagic element, string slug, int classLevel)
    {
        var next = classLevel + 1;
        if (next > 20)
        {
            return null;
        }
        var slots = new Dictionary<int, int>();
        var prepare = 0;
        foreach (var stat in element.Stats.Where(s => s.Level == next))
        {
            if (!int.TryParse(stat.Value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value))
            {
                continue;
            }
            var name = stat.Name.ToLowerInvariant();
            if (name == $"{slug}:spellcasting:prepare")
            {
                prepare += value;
            }
            else if (name.StartsWith($"{slug}:spellcasting:slots:", StringComparison.Ordinal) && int.TryParse(name[(slug.Length + 20)..], out var level) && level is >= 1 and <= 9)
            {
                slots[level] = slots.GetValueOrDefault(level) + value;
            }
        }
        var choices = element.Selects.Where(s => s.Level == next).Select(s => s.Number > 1 ? $"{s.Name} ×{s.Number}" : s.Name).ToList();
        return new NextLevelFacts(next, slots.Where(s => s.Value != 0).ToDictionary(), prepare, choices);
    }

    [GeneratedRegex(@"^Level \d+:\s*")]
    private static partial Regex LevelPrefix();
}
