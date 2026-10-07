using System.Text.Json;
using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>A campaign's export: what the DM reads of it, never a password, a token or a player's private note.</summary>
[TestClass]
public class CampaignExportTests
{
    private static CampaignEntry Entry(Guid campaign, string kind, string title, bool visible = true, string dmNotes = "", string data = "{}")
    {
        var e = CampaignEntry.Create(campaign, kind);
        e.Update(title, null, null, visible, $"{title} text", dmNotes, null, data, 0);
        return e;
    }

    [TestMethod]
    public void TheCampaign_SaysWhetherItHasPasswords_NeverTheirHashes()
    {
        var campaign = Campaign.Create("The test campaign");
        campaign.SetPasswordHash("pbkdf2$hash-of-the-players-password");
        campaign.SetDm("The DM", "pbkdf2$hash-of-the-dm-password");
        campaign.SetUseHomebrew(true);

        var exported = CampaignExport.Campaign(campaign);
        var json = JsonSerializer.Serialize(exported, CampaignExport.Json);

        exported.HasPassword.Should().BeTrue();
        exported.HasDmPassword.Should().BeTrue();
        exported.UseHomebrew.Should().BeTrue();
        exported.DmName.Should().Be("The DM");
        json.Should().NotContain("pbkdf2").And.NotContain("hash-of");
    }

    [TestMethod]
    public void Entries_AreTheDmsView_WithoutPlayersPrivateNotes()
    {
        var id = Guid.NewGuid();
        var fightEntry = Entry(id, "encounter", "The ambush", visible: false, dmNotes: "the wolves flee at half HP");
        fightEntry.SetFight("""{"round":2,"combatants":[{"id":"w1","name":"Wolf","hp":5,"maxHp":11}]}""");
        var entries = new[]
        {
            Entry(id, "npc", "The pastry seller", visible: false, dmNotes: "really a hag", data: """{"links":[{"category":"bestiary","key":"night%20hag_xmm","name":"Night Hag","dmOnly":true}]}"""),
            Entry(id, "ledger", "Loot", data: """{"coins":{"gp":12},"to":"party"}"""),
            fightEntry,
            Entry(id, CampaignEntry.Note, "Ada's secret", data: """{"scope":"private","author":"Ada"}"""),
            Entry(id, CampaignEntry.Note, "Party plan", data: """{"scope":"party","author":"Ada"}"""),
            Entry(id, CampaignEntry.Note, "DM notebook", visible: false, data: """{"scope":"dm","author":"DM"}"""),
        };

        var exported = CampaignExport.Entries(entries);

        exported.Select(e => e.Title).Should().BeEquivalentTo(["The pastry seller", "Loot", "The ambush", "Party plan", "DM notebook"]);
        exported.Single(e => e.Title == "The pastry seller").DmNotes.Should().Be("really a hag");
        exported.Single(e => e.Title == "The pastry seller").Data.GetRawText().Should().Contain("night%20hag_xmm");
        exported.Single(e => e.Title == "The ambush").Fight!.Value.GetProperty("combatants")[0].GetProperty("hp").GetInt32().Should().Be(5);
        exported.Single(e => e.Title == "Loot").Fight.Should().BeNull();
        JsonSerializer.Serialize(exported, CampaignExport.Json).Should().NotContain("Ada's secret");
    }

    [TestMethod]
    public void MagicItems_NameTheContentItemsTheyAre()
    {
        var id = Guid.NewGuid();
        var sword = Guid.NewGuid();
        var dagger = Guid.NewGuid();
        var entries = new[]
        {
            Entry(id, CampaignEntry.MagicItem, "The sun blade", data: $$"""{"elementId":"{{sword}}"}"""),
            Entry(id, CampaignEntry.MagicItem, "Another sun blade", data: $$"""{"elementId":"{{sword}}"}"""),
            Entry(id, CampaignEntry.MagicItem, "Ghost dagger", data: $$"""{"baseElementId":"{{dagger}}"}"""),
            Entry(id, CampaignEntry.MagicItem, "A trinket", data: "{}"),
            Entry(id, "npc", "Not an item", data: $$"""{"elementId":"{{Guid.NewGuid()}}"}"""),
        };

        var items = CampaignExport.ItemReferences(entries);

        items.Keys.Should().BeEquivalentTo([sword, dagger]);
        items[sword].Should().HaveCount(2);
    }

    [TestMethod]
    public void TheFileName_IsMadeFromTheCampaignsName()
    {
        CampaignExport.Slug("Curse of Strahd").Should().Be("curse-of-strahd");
        CampaignExport.Slug("  ../Évasion: 2 ").Should().Be("vasion-2");
        CampaignExport.Slug("!!!").Should().Be("campaign");
    }
}
