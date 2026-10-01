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
        CampaignEntry.Validate("npc", "Arik", null, null, new string('x', 50_001), "", null, "{}").Should().NotBeNull();
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
}
