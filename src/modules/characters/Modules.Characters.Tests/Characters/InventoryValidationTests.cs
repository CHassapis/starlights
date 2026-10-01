using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Tests.Characters;

[TestClass]
public class InventoryValidationTests
{
    private static InventoryItem Item(string id, string? container = null) => new() { Id = id, ElementId = Guid.NewGuid(), ContainerId = container };

    [TestMethod]
    public void AValidInventory_HasNoProblem()
    {
        var inventory = new CharacterInventory
        {
            Items = [Item("backpack"), Item("rope", "backpack"), Item("bag", "backpack"), Item("gem", "bag"), new() { Id = "own", Name = "Grandmother's locket" }],
            Coins = new() { ["gp"] = 15, ["sp"] = 3 },
        };

        inventory.Validate().Should().BeNull();
    }

    [TestMethod]
    public void AHomebrewItem_NeedsAName()
    {
        new CharacterInventory { Items = [new() { Id = "x" }] }.Validate().Should().Be("A homebrew item needs a name.");
    }

    [TestMethod]
    public void AContainerThatIsNotThere_IsRefused()
    {
        new CharacterInventory { Items = [Item("rope", "gone")] }.Validate().Should().Contain("not in the inventory");
    }

    [TestMethod]
    public void AnItemInAMissingContainersContainer_IsRefusedWithoutFailing()
    {
        new CharacterInventory { Items = [Item("gem", "bag"), Item("bag", "gone")] }.Validate().Should().Contain("not in the inventory");
    }

    [TestMethod]
    [DataRow("a", "a")]
    [DataRow("a", "b")]
    public void ContainersInsideThemselves_AreRefused(string first, string second)
    {
        var inventory = new CharacterInventory { Items = [Item("a", second == "a" ? "a" : "b"), Item("b", first == "a" && second == "b" ? "a" : null)] };

        inventory.Validate().Should().Be("Containers cannot be inside themselves.");
    }

    [TestMethod]
    public void UnknownCoins_AndDuplicateIds_AreRefused()
    {
        new CharacterInventory { Coins = new() { ["zp"] = 1 } }.Validate().Should().StartWith("Coins are");
        new CharacterInventory { Items = [Item("a"), Item("a")] }.Validate().Should().Be("Two items have the same id.");
    }

    [TestMethod]
    public void OutOfRangeValues_AreRefused()
    {
        new CharacterInventory { Items = [Item("a") with { Quantity = -1 }] }.Validate().Should().Contain("out of range");
        new CharacterInventory { Items = [Item("a") with { Custom = new() { Weight = -3 } }] }.Validate().Should().Contain("out of range");
    }

    [TestMethod]
    public void AnAttackPlace_IsWithinTheList()
    {
        new CharacterInventory { Items = [Item("sword") with { Attack = 1 }] }.Validate().Should().BeNull();
        new CharacterInventory { Items = [Item("sword") with { Attack = 0 }] }.Validate().Should().NotBeNull();
        new CharacterInventory { Items = [Item("sword") with { Attack = 101 }] }.Validate().Should().NotBeNull();
    }
}
