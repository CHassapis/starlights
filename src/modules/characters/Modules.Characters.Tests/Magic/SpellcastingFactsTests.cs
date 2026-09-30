using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Magic;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Characters.Tests.Magic;

/// <summary>
/// Where a character's spells go and what it may prepare, on the shapes of Aurora's data: a Death Domain cleric
/// with Magic Initiate from her background and a High Elf lineage spell (as Ilsa), a wizard's spellbook, a
/// sorcerer's known spells, a warlock's pact magic and a feat taken at a class level.
/// </summary>
[TestClass]
public class SpellcastingFactsTests
{
    private sealed class Build
    {
        public List<MagicRegistration> Registrations { get; } = [];
        public List<MagicClass> Classes { get; } = [];
        public Dictionary<Guid, ElementMagic> Magic { get; } = [];
        public List<SpellInfo> Spells { get; } = [];
        public Dictionary<string, int> Statistics { get; } = [];
        public List<string> Restricted { get; } = [];

        public Guid Add(string type, string name, Guid? parent, ElementMagic? magic = null, params MagicSelection[] selections)
        {
            var element = magic?.ElementId ?? Guid.NewGuid();
            var id = Guid.NewGuid();
            Registrations.Add(new MagicRegistration(id, parent, element, type, name, selections));
            if (magic is not null)
            {
                Magic[element] = magic;
            }
            return id;
        }

        public SpellInfo Spell(string name, int level, string lists, string? source = "Player's Handbook")
        {
            var spell = new SpellInfo { Id = Guid.NewGuid(), Name = name, AuroraId = "ID_" + name.ToUpperInvariant().Replace(' ', '_'), Level = level, Lists = lists.Split(','), Source = source };
            Spells.Add(spell);
            return spell;
        }

        public Guid Has(SpellInfo spell, Guid parent)
        {
            var id = Guid.NewGuid();
            Registrations.Add(new MagicRegistration(id, parent, spell.Id, "Spell", spell.Name, []));
            return id;
        }

        public SpellcastingFactsModel Facts() => SpellcastingFacts.Build(
            new MagicCharacter(Registrations, Classes, Classes.Sum(c => c.Level), 3, _ => 4, name => Statistics.TryGetValue(name, out var v) ? v : null, Restricted),
            Magic,
            new SpellIndexSnapshot(1, Spells));
    }

    private static ElementMagic Casting(string name, bool prepare = false, bool wholeList = false, MulticlassSlots? multiclass = null, string source = "Player's Handbook (2024)", SpellSelect[]? selects = null, SpellcastingStat[]? stats = null)
    {
        var id = Guid.NewGuid();
        return new ElementMagic(id, "Spellcasting", source, new SpellcastingDefinition(id, name, "Wisdom", prepare, wholeList, !prepare, false, [name], []), multiclass, [], selects ?? [], stats ?? []);
    }

    private static ElementMagic Granting(params SpellGrant[] grants) => new(Guid.NewGuid(), "Feature", null, null, null, grants, [], []);

    private static ElementMagic Selecting(params SpellSelect[] selects) => new(Guid.NewGuid(), "Feature", null, null, null, [], selects, []);

    [TestMethod]
    public void ACleric_LikeIlsa()
    {
        var b = new Build();
        var toll = b.Spell("Toll the Dead", 0, "Cleric,Wizard");
        var falseLife = b.Spell("False Life", 1, "Sorcerer,Wizard");
        var protection = b.Spell("Protection from Evil and Good", 1, "Cleric,Paladin,Warlock,Wizard");
        var light = b.Spell("Light", 0, "Bard,Cleric,Sorcerer,Wizard");
        var misty = b.Spell("Misty Step", 2, "Sorcerer,Warlock,Wizard");
        var bless = b.Spell("Bless", 1, "Cleric,Paladin");
        var aid = b.Spell("Aid", 2, "Cleric,Paladin");
        var fireball = b.Spell("Fireball", 3, "Sorcerer,Wizard");
        var dispel = b.Spell("Dispel Magic", 3, "Cleric,Wizard");
        b.Spell("Bless", 1, "Cleric,Paladin", source: "Player's Handbook (2024)");

        var cleric = b.Add("Class", "Cleric", null);
        b.Classes.Add(new MagicClass(cleric, "Cleric", 5));
        var casting = b.Add("Class Feature", "Level 1: Spellcasting", cleric, Casting("Cleric", prepare: true, wholeList: true, multiclass: MulticlassSlots.Full, selects: [new SpellSelect("Cantrip (Cleric)", "Cleric", false, 1, 3)]), new MagicSelection("Cantrip (Cleric)", toll.Id));
        b.Has(toll, casting);
        var domain = b.Add("SubClass", "Death Domain", cleric);
        var domainSpells = b.Add("Archetype Feature", "Domain Spells", domain, Granting(new SpellGrant(falseLife.AuroraId, "Cleric", true, 1)));
        b.Has(falseLife, domainSpells);
        // Magic Initiate (Cleric) from the Acolyte background: no spellcasting named
        var background = b.Add("Background", "Acolyte", null);
        var initiate = b.Add("Feat Feature", "Cleric", background, Selecting(new SpellSelect("Level 1 Spell (Magic Initiate)", null, false, null, 1), new SpellSelect("Cantrip (Magic Initiate)", null, false, null, 2)),
            new MagicSelection("Level 1 Spell (Magic Initiate)", protection.Id), new MagicSelection("Cantrip (Magic Initiate)", light.Id));
        b.Has(protection, initiate);
        b.Has(light, initiate);
        var lineage = b.Add("Species Feature", "High Elf", null);
        var wisdom = b.Add("Species Feature", "Wisdom", lineage, Granting(new SpellGrant(misty.AuroraId, null, false, 5)));
        b.Has(misty, wisdom);
        b.Statistics["cleric:spellcasting:slots:1"] = 4;
        b.Statistics["cleric:spellcasting:slots:2"] = 3;
        b.Statistics["cleric:spellcasting:slots:3"] = 2;
        b.Statistics["cleric:spellcasting:prepare"] = 9;
        b.Statistics["spellcasting:dc"] = 1;
        b.Restricted.Add("Player's Handbook (2024)");

        var facts = b.Facts();

        var c = facts.Casters.Should().ContainSingle().Subject;
        c.Name.Should().Be("Cleric");
        (c.Attack, c.Dc, c.DcBonus).Should().Be((7, 16, 1));
        c.ClassLevel.Should().Be(5);
        c.Edition.Should().Be("2024");
        c.PrepareMax.Should().Be(9);
        c.Slots.Should().BeEquivalentTo(new Dictionary<int, int> { [1] = 4, [2] = 3, [3] = 2 });
        c.Spells.Select(s => (s.Name, s.Kind)).Should().Equal(("Toll the Dead", "cantrip"), ("False Life", "always"), ("Protection from Evil and Good", "always"));
        c.Spells.Single(s => s.Name == "Protection from Evil and Good").Origin.Should().Be("Cleric (Acolyte)");
        facts.OtherSpells.Select(s => (s.Name, s.Kind, s.Origin)).Should().Equal(("Light", "cantrip", "Cleric (Acolyte)"), ("Misty Step", "known", "Wisdom (High Elf)"));
        // the cleric list up to 3rd level, from the ticked books only, without what is always prepared
        c.Preparable.Should().BeEquivalentTo([bless.Id, aid.Id, dispel.Id]);
        c.Preparable.Should().NotContain(fireball.Id);
    }

    [TestMethod]
    public void AWizard_PreparesFromTheSpellbook()
    {
        var b = new Build();
        var shield = b.Spell("Shield", 1, "Sorcerer,Wizard");
        var sleep = b.Spell("Sleep", 1, "Bard,Sorcerer,Wizard");
        var bolt = b.Spell("Fire Bolt", 0, "Sorcerer,Wizard");
        b.Spell("Magic Missile", 1, "Sorcerer,Wizard");
        var wizard = b.Add("Class", "Wizard", null);
        b.Classes.Add(new MagicClass(wizard, "Wizard", 1));
        var casting = b.Add("Class Feature", "Level 1: Spellcasting", wizard,
            Casting("Wizard", prepare: true, selects: [new SpellSelect("Cantrip (Wizard)", "Wizard", false, 1, 3), new SpellSelect("Spellbook (Wizard)", "Wizard", false, 1, 6)]),
            new MagicSelection("Spellbook (Wizard)", shield.Id), new MagicSelection("Spellbook (Wizard)", sleep.Id), new MagicSelection("Cantrip (Wizard)", bolt.Id));
        b.Has(shield, casting);
        b.Has(sleep, casting);
        b.Has(bolt, casting);
        // a High Elf's lineage spell on the wizard list stays apart from the spellbook (as Asha's in Aurora)
        var detect = b.Spell("Detect Magic", 1, "Cleric,Wizard");
        b.Has(detect, b.Add("Species Feature", "Intelligence", b.Add("Species Feature", "High Elf", null), Granting(new SpellGrant(detect.AuroraId, null, false, 3))));
        b.Statistics["wizard:spellcasting:slots:1"] = 2;
        b.Statistics["wizard:spellcasting:prepare"] = 4;

        var facts = b.Facts();
        var c = facts.Casters.Single();
        facts.OtherSpells.Select(s => (s.Name, s.Origin)).Should().Equal(("Detect Magic", "Intelligence (High Elf)"));

        c.Spellbook.Should().BeTrue();
        c.Spells.Select(s => (s.Name, s.Kind)).Should().Equal(("Fire Bolt", "cantrip"), ("Shield", "spellbook"), ("Sleep", "spellbook"));
        c.Preparable.Should().BeEquivalentTo([shield.Id, sleep.Id]);
    }

    [TestMethod]
    public void ASorcerer_KnowsSpells_AndSeesTheNextLevel()
    {
        var b = new Build();
        var bolt = b.Spell("Chromatic Orb", 1, "Sorcerer,Wizard");
        var sorcerer = b.Add("Class", "Sorcerer", null);
        b.Classes.Add(new MagicClass(sorcerer, "Sorcerer", 4));
        var casting = b.Add("Class Feature", "Level 1: Spellcasting", sorcerer,
            Casting("Sorcerer", multiclass: MulticlassSlots.Full,
                selects: [new SpellSelect("Spell (Sorcerer)", "Sorcerer", false, 5, 2), new SpellSelect("Cantrip (Sorcerer)", "Sorcerer", false, 4, 1)],
                stats: [new SpellcastingStat("sorcerer:spellcasting:slots:3", "2", 5), new SpellcastingStat("sorcerer:spellcasting:slots:1", "1", 3)]),
            new MagicSelection("Spell (Sorcerer)", bolt.Id));
        b.Has(bolt, casting);
        b.Statistics["sorcerer:spellcasting:slots:1"] = 4;
        b.Statistics["sorcerer:spellcasting:slots:2"] = 3;

        var c = b.Facts().Casters.Single();

        c.Prepares.Should().BeFalse();
        c.PrepareMax.Should().BeNull();
        c.Preparable.Should().BeEmpty();
        c.Spells.Single().Kind.Should().Be("known");
        c.Multiclass.Should().Be("Full");
        c.NextLevel!.Level.Should().Be(5);
        c.NextLevel.Slots.Should().BeEquivalentTo(new Dictionary<int, int> { [3] = 2 });
        c.NextLevel.Choices.Should().Equal("Spell (Sorcerer) ×2");
    }

    [TestMethod]
    public void AWarlock_HasPactSlots()
    {
        var b = new Build();
        var warlock = b.Add("Class", "Warlock", null);
        b.Classes.Add(new MagicClass(warlock, "Warlock", 5));
        b.Add("Class Feature", "Level 1: Pact Magic", warlock, Casting("Warlock", multiclass: MulticlassSlots.Solo));
        b.Statistics["warlock:spellcasting:slots:3"] = 2;
        b.Statistics["warlock:spellcasting:slot"] = 3;
        b.Statistics["warlock:spellcasting:attack"] = 1;

        var c = b.Facts().Casters.Single();

        c.Pact.Should().Be(new PactSlots(3, 2));
        c.Slots.Should().BeEmpty();
        c.AttackBonus.Should().Be(1);
        c.Attack.Should().Be(8);
    }

    [TestMethod]
    public void AFeatTakenAtAClassLevel_IsNotTheClassesSpell()
    {
        var b = new Build();
        var command = b.Spell("Command", 1, "Cleric,Paladin");
        var hex = b.Spell("Hex", 1, "Warlock");
        var fighter = b.Add("Class", "Fighter", null);
        var cleric = b.Add("Class", "Cleric", null);
        b.Classes.Add(new MagicClass(fighter, "Fighter", 4));
        b.Classes.Add(new MagicClass(cleric, "Cleric", 1));
        b.Add("Class Feature", "Level 1: Spellcasting", cleric, Casting("Cleric", prepare: true, wholeList: true));
        var asi = b.Add("Class Feature", "Level 4: Ability Score Improvement", fighter);
        var feat = b.Add("Feat", "Fey Touched", asi, Selecting(new SpellSelect("Spell (Fey Touched)", null, false, null, 1)), new MagicSelection("Spell (Fey Touched)", hex.Id));
        b.Has(hex, feat);
        var ritual = b.Add("Feat", "Magic Initiate", asi, Selecting(new SpellSelect("Level 1 Spell", null, false, null, 1)), new MagicSelection("Level 1 Spell", command.Id));
        b.Has(command, ritual);

        var facts = b.Facts();

        facts.Casters.Single().ClassLevel.Should().Be(1);
        facts.OtherSpells.Select(s => s.Name).Should().Equal("Hex");
        // on the cleric list, gained elsewhere: Aurora counts it as the cleric's, always prepared
        facts.Casters.Single().Spells.Select(s => (s.Name, s.Kind)).Should().Equal(("Command", "always"));
    }

    [TestMethod]
    public void MagicState_Validation()
    {
        new CharacterMagic { Prepared = new() { ["Cleric"] = [Guid.NewGuid()] }, ExpendedSlots = new() { [1] = 2 }, ExpendedPactSlots = 1 }.Validate().Should().BeNull();
        new CharacterMagic { ExpendedSlots = new() { [10] = 1 } }.Validate().Should().NotBeNull();
        new CharacterMagic { ExpendedSlots = new() { [1] = -1 } }.Validate().Should().NotBeNull();
        new CharacterMagic { Prepared = new() { [""] = [] } }.Validate().Should().NotBeNull();
        new CharacterMagic { Prepared = Enumerable.Range(0, 21).ToDictionary(i => $"c{i}", _ => new List<Guid>()) }.Validate().Should().NotBeNull();
    }
}
