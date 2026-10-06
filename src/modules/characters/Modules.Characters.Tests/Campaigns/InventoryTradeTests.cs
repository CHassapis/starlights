using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>Players handing each other items and coins.</summary>
[TestClass]
public class InventoryTradeTests
{
    private static readonly Guid Rapier = Guid.NewGuid();
    private static readonly Guid Registration = Guid.NewGuid();
    private static readonly Dictionary<string, int> NoCoins = [];

    private static CharacterInventory Giver() => new()
    {
        Revision = 4,
        Coins = new() { ["gp"] = 30, ["sp"] = 5 },
        Items =
        [
            new InventoryItem { Id = "rapier", ElementId = Rapier, Equipped = "Main Hand", Attuned = true, Attack = 1, ChargesUsed = 1, Notes = "whispers", RegistrationId = Registration },
            new InventoryItem { Id = "potions", Name = "Potion of Healing", Quantity = 3 },
            new InventoryItem { Id = "bag", Name = "Bag of Holding" },
            new InventoryItem { Id = "pouch", Name = "Pouch", ContainerId = "bag" },
            new InventoryItem { Id = "eye", Name = "Hag Eye", ContainerId = "pouch" },
        ],
    };

    private static CharacterInventory Taker() => new() { Revision = 9, Coins = new() { ["gp"] = 1 } };

    [TestMethod]
    public void AnItem_ArrivesUnequipped_KeepingItsChargesAndNotes()
    {
        var r = InventoryTrade.Move(Giver(), Taker(), "rapier", 0, NoCoins);

        r.Problem.Should().BeNull();
        r.From.Items.Should().NotContain(i => i.Id == "rapier");
        var arrived = r.To.Items.Single();
        arrived.ElementId.Should().Be(Rapier);
        arrived.Equipped.Should().BeNull();
        arrived.Attuned.Should().BeFalse();
        arrived.Attack.Should().BeNull();
        arrived.RegistrationId.Should().BeNull();
        arrived.ChargesUsed.Should().Be(1);
        arrived.Notes.Should().Be("whispers");
        // the giver's rules for it are what the endpoint removes
        r.Moved.Single().RegistrationId.Should().Be(Registration);
        r.From.Revision.Should().Be(5);
        r.To.Revision.Should().Be(10);
    }

    [TestMethod]
    public void PartOfAStack_LeavesTheRest()
    {
        var r = InventoryTrade.Move(Giver(), Taker(), "potions", 2, NoCoins);

        r.From.Items.Single(i => i.Id == "potions").Quantity.Should().Be(1);
        r.To.Items.Single().Quantity.Should().Be(2);
        InventoryTrade.Move(Giver(), Taker(), "potions", 4, NoCoins).Problem.Should().Be("There are only 3.");
    }

    [TestMethod]
    public void AContainer_GoesWithEverythingInside()
    {
        var r = InventoryTrade.Move(Giver(), Taker(), "bag", 0, NoCoins);

        r.Problem.Should().BeNull();
        r.Moved.Select(i => i.Id).Should().BeEquivalentTo(["bag", "pouch", "eye"]);
        r.From.Items.Select(i => i.Id).Should().BeEquivalentTo(["rapier", "potions"]);
        var bag = r.To.Items.Single(i => i.Name == "Bag of Holding");
        var pouch = r.To.Items.Single(i => i.Name == "Pouch");
        bag.ContainerId.Should().BeNull();
        pouch.ContainerId.Should().Be(bag.Id);
        r.To.Items.Single(i => i.Name == "Hag Eye").ContainerId.Should().Be(pouch.Id);
    }

    [TestMethod]
    public void Coins_MoveFromPurseToPurse_NeverMoreThanThereAre()
    {
        var r = InventoryTrade.Move(Giver(), Taker(), null, 0, new Dictionary<string, int> { ["gp"] = 10, ["sp"] = 5 });

        r.From.Coins["gp"].Should().Be(20);
        r.From.Coins["sp"].Should().Be(0);
        r.To.Coins["gp"].Should().Be(11);
        r.To.Coins["sp"].Should().Be(5);
        InventoryTrade.Move(Giver(), Taker(), null, 0, new Dictionary<string, int> { ["pp"] = 1 }).Problem.Should().Be("Not that many coins in the purse.");
        InventoryTrade.Move(Giver(), Taker(), null, 0, NoCoins).Problem.Should().Be("Give an item or some coins.");
        InventoryTrade.Move(Giver(), Taker(), "gone", 0, NoCoins).Problem.Should().NotBeNull();
    }
}
