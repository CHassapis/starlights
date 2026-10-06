using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Characters.Tests.Registrations;

/// <summary>Aurora's equipped conditions, answered from what the character wears and holds.</summary>
[TestClass]
public class EquippedConditionTests
{
    private static ItemInfo Item(string name, ArmorInfo? armor = null, WeaponInfo? weapon = null) => new()
    {
        Id = Guid.NewGuid(), Name = name, ElementType = armor is not null ? "Armor" : "Weapon", AuroraId = name, Categories = [], Armor = armor, Weapon = weapon,
    };

    private static readonly ItemInfo Plate = Item("Plate", new ArmorInfo("Heavy", 18, 15, true, null));
    private static readonly ItemInfo Leather = Item("Leather", new ArmorInfo("Light", 11, null, false, null));
    private static readonly ItemInfo Shield = Item("Shield", new ArmorInfo("Shield", 2, null, false, null));
    private static readonly ItemInfo Longsword = Item("Longsword", weapon: new WeaponInfo("1d8", "slashing", "1d10", null, ["Versatile"], true, false, null, null));
    private static readonly ItemInfo Greatsword = Item("Greatsword", weapon: new WeaponInfo("2d6", "slashing", null, null, ["Heavy", "Two-Handed"], true, false, null, null));
    private static readonly ItemCatalogSnapshot Catalog = new(1, [Plate, Leather, Shield, Longsword, Greatsword]);

    private static Func<string, bool> Wearing(params (ItemInfo Item, string Slot)[] equipped)
    {
        var inventory = new CharacterInventory { Items = equipped.Select((e, i) => new InventoryItem { Id = $"i{i}", ElementId = e.Item.Id, Equipped = e.Slot }).ToList() };
        return EquippedState.From(inventory, Catalog).Holds;
    }

    private static bool Holds(string condition, Func<string, bool> equipped) =>
        RequirementsExpression.Evaluate(condition, _ => false, _ => null, equipped);

    [TestMethod]
    public void UnarmoredMovementNeedsNoArmorAndNoShield()
    {
        const string condition = "[equipped:armor:none],[equipped:shield:none]";
        Holds(condition, Wearing()).Should().BeTrue();
        Holds(condition, Wearing((Shield, "Off Hand"))).Should().BeFalse();
        Holds(condition, Wearing((Leather, "Armor"))).Should().BeFalse();
    }

    [TestMethod]
    public void FastMovementIsLostInHeavyArmorOnly()
    {
        const string condition = "![equipped:armor:heavy]";
        Holds(condition, Wearing()).Should().BeTrue();
        Holds(condition, Wearing((Leather, "Armor"))).Should().BeTrue();
        Holds(condition, Wearing((Plate, "Armor"))).Should().BeFalse();
    }

    [TestMethod]
    public void DuelingWantsOneWeaponAndAtMostAShield()
    {
        const string condition = "[equipped:primary:any],([equipped:secondary:none]||[equipped:shield:any])";
        Holds(condition, Wearing((Longsword, "Main Hand"))).Should().BeTrue();
        Holds(condition, Wearing((Longsword, "Main Hand"), (Shield, "Off Hand"))).Should().BeTrue();
        Holds(condition, Wearing((Greatsword, "Two-Handed"))).Should().BeFalse();
        Holds(condition, Wearing((Longsword, "Main Hand"), (Longsword, "Off Hand"))).Should().BeFalse();
    }

    [TestMethod]
    public void WeaponPropertiesAndUnknownEquipment()
    {
        Holds("[equipped:primary:versatile]", Wearing((Longsword, "Two-Handed"))).Should().BeTrue();
        Holds("[equipped:primary:versatile]", Wearing((Greatsword, "Two-Handed"))).Should().BeFalse();
        // without an equipment reader the term is unknown: it does not hold
        RequirementsExpression.Evaluate("[equipped:armor:none]", _ => false, _ => null).Should().BeFalse();
    }
}
