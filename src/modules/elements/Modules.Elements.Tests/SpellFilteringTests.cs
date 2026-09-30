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
}
