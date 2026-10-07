using System.Text.Json;
using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>What players may read of a campaign: nothing the DM has not revealed, and never the DM's notes.</summary>
[TestClass]
public class CampaignViewTests
{
    private static readonly Guid CampaignId = Guid.NewGuid();

    private static CampaignEntry Entry(string kind, string title, bool visible, string dmNotes = "", string data = "{}")
    {
        var e = CampaignEntry.Create(CampaignId, kind);
        e.Update(title, null, null, visible, $"{title} body", dmNotes, null, data, 0);
        return e;
    }

    private static List<CampaignEntry> Sample() =>
    [
        Entry("session", "Session 2", visible: true, dmNotes: "Strahd is waiting for Corin"),
        Entry("npc", "Ireena", visible: false, dmNotes: "Tatyana reborn"),
        Entry("handout", "Strahd's letter", visible: false),
        Entry("ledger", "Wolf pelts sold", visible: false, dmNotes: "they were overpaid", data: """{"coins":{"gp":12},"to":"party"}"""),
    ];

    [TestMethod]
    public void Players_SeeOnlyRevealedEntries_AndEveryLedgerLine()
    {
        var view = CampaignView.Entries(Sample(), dm: false);

        view.Select(e => e.Title).Should().BeEquivalentTo(["Session 2", "Wolf pelts sold"]);
        view.Should().OnlyContain(e => e.Visible);
    }

    [TestMethod]
    public void Players_NeverGetTheDmsNotes()
    {
        var view = CampaignView.Entries(Sample(), dm: false);

        view.Should().OnlyContain(e => e.DmNotes == null);
        string.Join("|", view.Select(e => $"{e.Title} {e.Body} {e.Data.GetRawText()}")).Should().NotContain("Strahd is waiting").And.NotContain("overpaid").And.NotContain("Tatyana");
    }

    [TestMethod]
    public void Players_SeeAnAlias_ButNeverItsDmOnlyStatBlockLink()
    {
        // a revealed alias: players may read "the youngest hag", not the night hag stat block that says who she is
        var alias = Entry("npc", "The youngest hag", visible: true, dmNotes: "Really the third sister", data: """
            {"role":"Of the old mill","links":[
              {"category":"bestiary","key":"night%20hag_xmm","name":"Night Hag","dmOnly":true},
              {"category":"bestiary","key":"green%20hag_xmm","name":"Green Hag","dmOnly":"yes"},
              {"category":"items","key":"hag%20eye_xdmg","name":"Hag Eye","dmOnly":false}]}
            """);

        var player = CampaignView.Entries([alias], dm: false).Single();
        var sent = JsonSerializer.Serialize(player);

        player.Title.Should().Be("The youngest hag");
        player.Data.GetProperty("role").GetString().Should().Be("Of the old mill");
        player.Data.GetProperty("links").EnumerateArray().Select(l => l.GetProperty("name").GetString()).Should().Equal("Hag Eye");
        sent.Should().NotContain("night%20hag").And.NotContain("Night Hag").And.NotContain("Green Hag").And.NotContain("dmOnly").And.NotContain("third sister");

        var dm = CampaignView.Entries([alias], dm: true).Single();
        dm.Data.GetProperty("links").GetArrayLength().Should().Be(3);
        JsonSerializer.Serialize(dm).Should().Contain("night%20hag_xmm");
    }

    [TestMethod]
    public void TheDm_SeesEverything()
    {
        var view = CampaignView.Entries(Sample(), dm: true);

        view.Should().HaveCount(4);
        view.Single(e => e.Title == "Ireena").DmNotes.Should().Be("Tatyana reborn");
        view.Single(e => e.Title == "Ireena").Visible.Should().BeFalse();
    }

    [TestMethod]
    public void Entries_AreChecked()
    {
        CampaignEntry.Validate("session", "Session 1", 1, "2026-09-28", "", "", null, "{}").Should().BeNull();
        CampaignEntry.Validate("diary", "x", null, null, "", "", null, "{}").Should().NotBeNull();
        CampaignEntry.Validate("npc", " ", null, null, "", "", null, "{}").Should().NotBeNull();
        CampaignEntry.Validate("session", "Into Vallaki", null, null, "", new string('x', 100_000), null, "{}").Should().BeNull();
        CampaignEntry.Validate("npc", "Arik", null, null, new string('x', 200_001), "", null, "{}").Should().NotBeNull();
        CampaignEntry.Validate("magicitem", "Sunsword", null, null, "", "", null, $$"""{"rarity":"legendary","elementId":"{{Guid.NewGuid()}}"}""").Should().BeNull();
        CampaignEntry.Validate("magicitem", "Sunsword", null, null, "", "", null, """{"elementId":"the sun"}""").Should().NotBeNull();
        CampaignEntry.Validate("npc", "Arik", null, null, "", "", null, "[1]").Should().NotBeNull();
        CampaignEntry.Validate("ledger", "Loot", null, null, "", "", null, """{"coins":{"gp":-30,"sp":5},"to":"party","items":["Sunsword"]}""").Should().BeNull();
        CampaignEntry.Validate("ledger", "Loot", null, null, "", "", null, """{"coins":{"gp":1.5}}""").Should().NotBeNull();
        CampaignEntry.Validate("ledger", "Loot", null, null, "", "", null, """{"coins":{"zp":1}}""").Should().NotBeNull();
        CampaignEntry.Validate("ledger", "Loot", null, null, "", "", null, """{"to":"the moon"}""").Should().NotBeNull();
        CampaignEntry.Validate("ledger", "Loot", null, null, "", "", null, $$"""{"to":"{{Guid.NewGuid()}}"}""").Should().BeNull();
        Campaign.Validate("Curse of Strahd", "", null, []).Should().BeNull();
        Campaign.Validate("", "", null, []).Should().NotBeNull();
        Campaign.Validate("x", "", null, Enumerable.Range(0, 21).Select(_ => Guid.NewGuid()).ToList()).Should().NotBeNull();
    }

    [TestMethod]
    public void Notes_PrivateToTheirAuthor_PartyForAll_DmForTheDm()
    {
        var campaign = Guid.NewGuid();
        CampaignEntry Note(string scope, string author)
        {
            var e = CampaignEntry.Create(campaign, CampaignEntry.Note);
            e.Update($"{scope} of {author}", null, null, scope == "party", "text", "", null, $$"""{"scope":"{{scope}}","author":"{{author}}"}""", 0);
            return e;
        }
        var notes = new[] { Note("private", "Ada"), Note("party", "Ada"), Note("dm", "DM"), Note("private", "Ben") };

        CampaignView.Entries(notes, dm: false, reader: "ada").Select(e => e.Title).Should().BeEquivalentTo(["private of Ada", "party of Ada"]);
        CampaignView.Entries(notes, dm: false, reader: null).Select(e => e.Title).Should().BeEquivalentTo(["party of Ada"]);
        // the DM reads the party's notes and their own notebook, never a player's private note
        CampaignView.Entries(notes, dm: true, reader: null).Select(e => e.Title).Should().BeEquivalentTo(["party of Ada", "dm of DM"]);
    }
}
