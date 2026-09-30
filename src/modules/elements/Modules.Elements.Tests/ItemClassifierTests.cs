using System.Text.RegularExpressions;
using AwesomeAssertions;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Services.Items;

namespace Starlights.Modules.Elements.Tests;

[TestClass]
public class ItemClassifierTests
{
    private static ItemInfo Classify(string type, string name, string body, Func<string, string?>? names = null) =>
        ItemClassifier.Classify(Guid.NewGuid(), name, type, "ID_TEST", "Test", $"<element name=\"{name}\" type=\"{type}\">{body}</element>", names ?? (_ => null));

    [TestMethod]
    public void Longsword_IsAWeaponWithItsFigures()
    {
        var item = Classify("Weapon", "Longsword", """
            <supports>ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE, ID_INTERNAL_DAMAGE_TYPE_SLASHING, ID_INTERNAL_WEAPON_PROPERTY_VERSATILE, ID_WOTC_PHB24_WEAPON_PROPERTY_SAP</supports>
            <setters><set name="category">Weapons</set><set name="damage" type="slashing">1d8</set><set name="versatile">1d10</set>
            <set name="weight" lb="3">3 lb.</set><set name="cost" currency="gp">15</set><set name="slot">onehand</set>
            <set name="proficiency">ID_PROFICIENCY_WEAPON_PROFICIENCY_LONGSWORD</set></setters>
            """);

        item.Categories.Should().Equal("Weapons");
        item.Magic.Should().BeNull();
        item.Weight.Should().Be(3);
        item.Cost.Should().Be(15);
        item.Weapon.Should().BeEquivalentTo(new WeaponInfo("1d8", "slashing", "1d10", null, ["Versatile"], true, false, "ID_PROFICIENCY_WEAPON_PROFICIENCY_LONGSWORD", null));
        item.HasRules.Should().BeFalse();
    }

    [TestMethod]
    public void ChainMail_IsHeavyArmorWithStealthDisadvantage()
    {
        var item = Classify("Armor", "Chain Mail", """
            <setters><set name="category">Armor</set><set name="armor">Heavy</set><set name="armorClass">16</set><set name="strength">13</set>
            <set name="stealth">Disadvantage</set><set name="weight" lb="55">55 lb.</set></setters>
            <rules><stat name="ac:armored:armor" value="16" /></rules>
            """);

        item.Categories.Should().Equal("Armor");
        item.Armor.Should().Be(new ArmorInfo("Heavy", 16, 13, true, null));
    }

    [TestMethod]
    public void Shield_ArmorClassIsTheBonus()
    {
        var item = Classify("Armor", "Shield", """<setters><set name="category">Armor</set><set name="armor">Shield</set><set name="armorClass">+2</set></setters>""");

        item.Armor!.Kind.Should().Be("Shield");
        item.Armor.ArmorClass.Should().Be(2);
    }

    [TestMethod]
    public void FlameTongue_IsAMagicWeaponMadeFromAnyMeleeWeapon()
    {
        var item = Classify("Magic Item", "Flame Tongue", """
            <setters><set name="category">Magic Weapons</set><set name="type" addition="Any Melee Weapon">Weapon</set>
            <set name="weapon">ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE</set>
            <set name="rarity">Rare</set><set name="attunement">true</set><set name="name-format">Flame Tongue {{parent}}</set></setters>
            """);

        item.Categories.Should().Equal("Magic Weapons", "Weapons");
        item.Magic.Should().Be(new MagicInfo("Rare", true, null, null, false, null));
        item.Base.Should().Be(new BaseItemInfo("Weapon", "ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE", "Flame Tongue {{parent}}"));
    }

    [TestMethod]
    public void WeaponPlusOne_AddsToAttackAndDamage()
    {
        var item = Classify("Magic Item", "Weapon, +1", """
            <setters><set name="category">Magic Weapons</set><set name="type" addition="any">Weapon</set><set name="rarity">Uncommon</set>
            <set name="enhancement">1</set><set name="weapon">ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED</set></setters>
            """);

        item.Magic!.Enhancement.Should().Be(1);
        item.Effects.Should().Contain("+1 to attack and damage rolls");
    }

    [TestMethod]
    public void MagicArmorOnAnArmorGroup_NeedsABaseArmor_AndAddsAC()
    {
        var item = Classify("Magic Item", "Armor, +1", """
            <setters><set name="category">Magic Armor</set><set name="type">Armor</set><set name="rarity">Rare</set><set name="enhancement">1</set>
            <set name="armor">ID_INTERNAL_ARMOR_GROUP_LIGHT|ID_INTERNAL_ARMOR_GROUP_MEDIUM|ID_INTERNAL_ARMOR_GROUP_HEAVY</set></setters>
            <rules><stat name="ac:armored:enhancement" value="1" bonus="enhancement" /></rules>
            """);

        item.Categories.Should().Equal("Magic Armor", "Armor");
        item.Base!.Kind.Should().Be("Armor");
        item.Effects.Should().Equal("+1 AC");
        item.HasRules.Should().BeTrue();
    }

    [TestMethod]
    public void CloakOfProtection_SaysWhatItDoes()
    {
        var item = Classify("Magic Item", "Cloak of Protection", """
            <setters><set name="category">Wondrous Items</set><set name="type">Wondrous Item</set><set name="rarity">Uncommon</set>
            <set name="attunement">true</set><set name="slot">shoulders</set></setters>
            <rules><stat name="ac:misc" value="1" /><stat name="strength:save:misc" value="1" /><stat name="dexterity:save:misc" value="1" />
            <stat name="constitution:save:misc" value="1" /><stat name="intelligence:save:misc" value="1" /><stat name="wisdom:save:misc" value="1" />
            <stat name="charisma:save:misc" value="1" /></rules>
            """);

        item.Categories.Should().Equal("Wondrous Items");
        item.Magic!.Attunement.Should().BeTrue();
        item.Slot.Should().Be("shoulders");
        item.Effects.Should().BeEquivalentTo(["+1 to all saving throws", "+1 AC"]);
    }

    [TestMethod]
    public void RodOfThePactKeeper_ClassSpellBonuses()
    {
        var item = Classify("Magic Item", "Rod of the Pact Keeper, +1", """
            <setters><set name="category">Rods</set><set name="type">Rod</set><set name="attunement" addition="by a warlock">true</set></setters>
            <rules><stat name="warlock:spellcasting:attack" value="1" /><stat name="warlock:spellcasting:dc" value="1" /></rules>
            """);

        item.Categories.Should().Equal("Rods");
        item.Magic!.AttunementBy.Should().Be("by a warlock");
        item.Effects.Should().Equal("+1 to Warlock spell attack rolls", "+1 to Warlock spell save DC");
    }

    [TestMethod]
    public void GauntletsOfOgrePower_SetStrength()
    {
        var item = Classify("Magic Item", "Gauntlets of Ogre Power", """
            <setters><set name="category">Wondrous Items</set><set name="type">Wondrous Item</set><set name="attunement">true</set></setters>
            <rules><stat name="strength:score:set" value="19" bonus="base" /></rules>
            """);

        item.Effects.Should().Equal("Strength becomes 19 (unless it is higher)");
    }

    [TestMethod]
    public void Grants_AreNamed_AndBuiltInConditionsAreSpelledOut()
    {
        var names = new Dictionary<string, string> { ["ID_SPELL_FIREBALL"] = "Fireball", ["ID_SPELL_BURNING_HANDS"] = "Burning Hands" };
        var item = Classify("Magic Item", "Staff of Fire", """
            <setters><set name="category">Staffs</set><set name="type">Staff</set><set name="charges">10</set></setters>
            <rules><grant type="Spell" id="ID_SPELL_BURNING_HANDS" /><grant type="Spell" id="ID_SPELL_FIREBALL" />
            <grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" /></rules>
            """, names.GetValueOrDefault);

        item.Magic!.Charges.Should().Be(10);
        item.Effects.Should().Equal("You can cast Burning Hands and Fireball", "Resistance to fire damage");
    }

    [TestMethod]
    public void BagOfHolding_IsAWeightlessContainer()
    {
        var item = Classify("Magic Item", "Bag of Holding", """
            <setters><set name="category">Wondrous Items</set><set name="weight" lb="15">15 lb.</set><set name="stash" lb="500" weightless="true">true</set>
            <set name="type">Wondrous Item</set><set name="rarity">Uncommon</set></setters>
            """);

        item.Container.Should().Be(new ContainerInfo(500, true, false));
        item.Weight.Should().Be(15);
    }

    [TestMethod]
    [DataRow("Backpack", 30)]
    [DataRow("Pouch", 6)]
    [DataRow("Chest", 300)]
    public void RulebookContainers_HaveTheirCapacity(string name, int capacity)
    {
        var item = Classify("Item", name, """<setters><set name="category">Adventuring Gear</set><set name="weight" lb="5">5 lb.</set></setters>""");

        item.Container.Should().Be(new ContainerInfo(capacity, false, false));
    }

    [TestMethod]
    public void MountsAndVehicles_AreDetachedAndLeftOutOfEncumbrance()
    {
        var cart = Classify("Item", "Cart", """
            <setters><set name="category">Mounts &amp; Vehicles</set><set name="weight" lb="200" excludeEncumbrance="true">200 lb.</set><set name="type">Vehicle</set></setters>
            """);

        cart.Categories.Should().Equal("Mounts & Vehicles");
        cart.ExcludeEncumbrance.Should().BeTrue();
        cart.Container!.Detached.Should().BeTrue();
    }

    [TestMethod]
    public void HolySymbol_IsASpellcastingFocus()
    {
        var item = Classify("Item", "Amulet", """<setters><set name="category">Adventuring Gear</set><set name="container">Holy Symbol</set></setters>""");

        item.Categories.Should().Equal("Adventuring Gear", "Spellcasting Focus");
    }

    [TestMethod]
    public void SpellScroll_IsAlsoASpellScroll()
    {
        var item = Classify("Magic Item", "Spell Scroll, Level 1", """<setters><set name="category">Scrolls</set><set name="type">Scroll</set><set name="rarity">Common</set></setters>""");

        item.Categories.Should().Equal("Scrolls", "Spell Scrolls");
    }

    [TestMethod]
    public void AdditionalFeatures_AreBuildOptions()
    {
        var item = Classify("Item", "Speed: Fly +10 Feet", """
            <setters><set name="category">Additional Feature</set><set name="inventory-hidden">true</set></setters>
            <rules><stat name="innate speed:fly" value="10" /></rules>
            """);

        item.BuildOption.Should().BeTrue();
        item.Hidden.Should().BeTrue();
    }

    /// <summary>
    /// Every item of the real content (when the Aurora elements repository is available, e.g. in the test run with
    /// AURORA_ELEMENTS set) is classified without errors, has a category, and build options are recognised.
    /// </summary>
    [TestMethod]
    public void EveryAuroraItem_HasACategory()
    {
        var root = Environment.GetEnvironmentVariable("AURORA_ELEMENTS");
        if (string.IsNullOrEmpty(root) || !Directory.Exists(root))
        {
            Assert.Inconclusive("AURORA_ELEMENTS is not set to a clone of github.com/AuroraLegacy/elements");
        }

        var items = new List<ItemInfo>();
        foreach (var file in Directory.EnumerateFiles(root, "*.xml", SearchOption.AllDirectories))
        {
            var document = System.Xml.Linq.XDocument.Load(file);
            foreach (var element in document.Descendants("element"))
            {
                var type = (string?)element.Attribute("type");
                if (type is null || !ItemClassifier.ItemTypes.Contains(type))
                {
                    continue;
                }
                items.Add(ItemClassifier.Classify(Guid.NewGuid(), (string)element.Attribute("name")!, type, (string?)element.Attribute("id") ?? "", (string?)element.Attribute("source"), element.ToString(), _ => null));
            }
        }

        items.Should().HaveCountGreaterThan(2500);
        items.Should().OnlyContain(i => i.Categories.Count > 0);
        items.Count(i => i.BuildOption).Should().BeGreaterThan(70);
        items.Where(i => i.Categories.Contains("Magic Weapons")).Should().OnlyContain(i => i.Categories.Contains("Weapons"));
        items.Where(i => i.Weapon is not null).Should().OnlyContain(i => Regex.IsMatch(i.Weapon!.Damage, @"\d|—|-"));
        // every category the picker offers is used by at least one item
        string[] offered = ["Adventuring Gear", "Treasure", "Trade Goods", "Equipment Packs", "Tools", "Musical Instruments", "Armor", "Magic Armor",
            "Weapons", "Magic Weapons", "Ammunition", "Spellcasting Focus", "Wondrous Items", "Supernatural Gifts", "Staffs", "Rods", "Wands", "Rings",
            "Potions", "Poison", "Scrolls", "Spell Scrolls", "Explosives", "Mounts & Vehicles"];
        offered.Should().OnlyContain(c => items.Any(i => i.Categories.Contains(c)));
    }
}
