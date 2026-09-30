using Starlights.Modules.Elements.Integration;
using AwesomeAssertions;
using Starlights.Modules.Elements.Services;
using Starlights.Modules.Elements.Services.Spells;

namespace Starlights.Modules.Elements.Tests;

[TestClass]
public class SpellFilteringTests
{
    private static readonly string[] Fireball = ["Sorcerer", "Wizard", "3"];
    private static readonly string[] Guidance = ["Artificer", "Cleric", "Druid", "0"];
    private static readonly string[] CureWounds = ["Bard", "Cleric", "Druid", "Paladin", "Ranger", "1"];

    private static bool Offers(string supports, string[] lists, int[] slots, string[] spell) =>
        SupportsExpression.Compile(SupportsExpression.FillSpellPlaceholders(supports, lists, slots), numbersAreTerms: true)(spell, "ID_X");

    [TestMethod]
    public void ACantripSelection_OffersTheClassCantripsOnly()
    {
        Offers("$(spellcasting:list), 0", ["Cleric"], [1, 2, 3], Guidance).Should().BeTrue();
        Offers("$(spellcasting:list), 0", ["Cleric"], [1, 2, 3], CureWounds).Should().BeFalse();
        Offers("$(spellcasting:list), 0", ["Wizard"], [1, 2, 3], Guidance).Should().BeFalse();
    }

    [TestMethod]
    public void ASpellSelection_OffersTheClassSpellsOfTheLevelsWithSlots()
    {
        Offers("$(spellcasting:list), $(spellcasting:slots)", ["Sorcerer"], [1, 2, 3], Fireball).Should().BeTrue();
        Offers("$(spellcasting:list), $(spellcasting:slots)", ["Sorcerer"], [1, 2], Fireball).Should().BeFalse();
        Offers("$(spellcasting:list), $(spellcasting:slots)", ["Sorcerer"], [1, 2, 3], Guidance).Should().BeFalse();
    }

    [TestMethod]
    public void ExtraLists_AreOffered_AndNoSlotsMeansNoSpells()
    {
        Offers("$(spellcasting:list), $(spellcasting:slots)", ["Bard", "Cleric"], [1], CureWounds).Should().BeTrue();
        Offers("$(spellcasting:list), $(spellcasting:slots)", ["Bard"], [], CureWounds).Should().BeFalse();
    }

    [TestMethod]
    public void OutsideSpellSelections_NumbersStillMatchEverything()
    {
        SupportsExpression.Compile("Skill, 2")(["Skill"], "ID_X").Should().BeTrue();
    }

    [TestMethod]
    public void AuroraSpellcasting_IsRead()
    {
        var id = Guid.NewGuid();
        var cleric = SpellIndex.ReadSpellcasting(id, """
            <element name="Spellcasting" type="Class Feature"><spellcasting name="Cleric" ability="Wisdom" prepare="true"><list known="true">Cleric</list></spellcasting></element>
            """);
        cleric.Should().BeEquivalentTo(new Integration.SpellcastingDefinition(id, "Cleric", "Wisdom", true, true, false, false, ["Cleric"], []));

        var secrets = SpellIndex.ReadSpellcasting(id, """<element name="Magical Secrets"><spellcasting name="Bard" extend="true"><extend>Cleric</extend><extend>Druid</extend><extend>Wizard</extend></spellcasting></element>""");
        secrets!.Extend.Should().BeTrue();
        secrets.Extends.Should().Equal("Cleric", "Druid", "Wizard");

        var sorcerer = SpellIndex.ReadSpellcasting(id, """<element name="Spellcasting"><spellcasting name="Sorcerer" ability="Charisma" allowReplace="true"><list>Sorcerer</list></spellcasting></element>""");
        sorcerer!.AllowReplace.Should().BeTrue();
        sorcerer.Prepare.Should().BeFalse();
        sorcerer.KnowsWholeList.Should().BeFalse();
    }

    [TestMethod]
    public void AnElementsMagic_IsReadFromItsXml()
    {
        var id = Guid.NewGuid();
        var magic = SpellIndex.ReadMagic(id, """
            <element name="Level 1: Pact Magic" type="Class Feature" source="Player's Handbook (2024)" id="ID_PACT">
              <spellcasting name="Warlock" ability="Charisma" allowReplace="true"><list>Warlock</list></spellcasting>
              <rules>
                <grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO" requirements="ID_INTERNAL_GRANT_MULTICLASS"/>
                <grant type="Spell" id="ID_PHB_SPELL_FALSE_LIFE" level="1" spellcasting="Warlock" prepared="true" />
                <grant type="Proficiency" id="ID_SOMETHING" />
                <select type="Spell" name="Cantrip (Warlock)" supports="$(spellcasting:list), 0" number="2" spellcasting="Warlock" />
                <stat name="warlock:spellcasting:slots:count" value="1" level="2"/>
                <stat name="warlock:spellcasting:slots:1" value="warlock:spellcasting:slots:count" level="1" />
                <stat name="strength" value="1" />
              </rules>
            </element>
            """)!;

        magic.Spellcasting!.Name.Should().Be("Warlock");
        magic.Multiclass.Should().Be(MulticlassSlots.Solo);
        magic.Source.Should().Be("Player's Handbook (2024)");
        magic.Grants.Should().Equal(new SpellGrant("ID_PHB_SPELL_FALSE_LIFE", "Warlock", true, 1));
        magic.Selects.Should().Equal(new SpellSelect("Cantrip (Warlock)", "Warlock", false, null, 2));
        magic.Stats.Select(s => (s.Name, s.Level)).Should().Equal(("warlock:spellcasting:slots:count", 2), ("warlock:spellcasting:slots:1", 1));
        SpellIndex.ReadMagic(id, """<element name="Longsword" type="Item"><rules><stat name="ac" value="1"/></rules></element>""").Should().BeNull();
    }
}
