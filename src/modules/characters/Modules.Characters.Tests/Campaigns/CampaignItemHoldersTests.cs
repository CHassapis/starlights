using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>Who in the party has each of the campaign's magic items.</summary>
[TestClass]
public class CampaignItemHoldersTests
{
    private static readonly Guid CampaignId = Guid.NewGuid();
    private static readonly Guid Rapier = Guid.NewGuid();
    private static readonly Guid Fedra = Guid.NewGuid();
    private static readonly Guid Barry = Guid.NewGuid();

    private static CampaignEntry Item(string title, string data)
    {
        var e = CampaignEntry.Create(CampaignId, CampaignEntry.MagicItem);
        e.Update(title, null, null, true, string.Empty, string.Empty, null, data, 0);
        return e;
    }

    [TestMethod]
    public void FindsBookItemsByElement_AndTheCampaignsOwnItemsByName()
    {
        var rapier = Item("Ashen Rapier", $$"""{"elementId":"{{Rapier}}"}""");
        var locket = Item("Grandmother's locket", "{}");
        var lost = Item("Sunsword", "{}");
        var party = new List<(Guid, string, CharacterInventory)>
        {
            (Fedra, "Fedra", new CharacterInventory { Items = [new InventoryItem { Id = "a", Name = "Grandmother's Locket", Custom = new CustomItem { Source = "Curse of Strahd" } }] }),
            (Barry, "Barry", new CharacterInventory { Items = [new InventoryItem { Id = "b", ElementId = Rapier }, new InventoryItem { Id = "c", ElementId = Rapier, Quantity = 2 }] }),
        };

        var holders = CampaignItemHolders.Find([rapier, locket, lost], "Curse of Strahd", party);

        holders.Should().BeEquivalentTo([new ItemHolder(rapier.Id, Barry, "Barry", 3), new ItemHolder(locket.Id, Fedra, "Fedra", 1)]);
        // a homebrew item of the same name from elsewhere is not the campaign's
        CampaignItemHolders.Find([locket], "Another campaign", party).Should().BeEmpty();
    }
}
