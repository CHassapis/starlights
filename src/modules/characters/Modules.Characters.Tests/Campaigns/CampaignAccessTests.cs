using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Players;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>Who gets into what: the reserved names behind the admin and campaign tokens, and campaign tokens.</summary>
[TestClass]
public class CampaignAccessTests
{
    private static PlayerAccess Access() => new(null!, new PlayerAccessOptions("test-key"));

    [TestMethod]
    [DataRow("*admin*", true)]
    [DataRow("  *admin*", true)]
    [DataRow("#campaign:0123", true)]
    [DataRow("C Hassapis", false)]
    [DataRow("Ada Lark", false)]
    public void NamesBehindTokens_AreNotPlayersToHave(string name, bool reserved)
    {
        PlayerAccess.IsReservedName(name).Should().Be(reserved);
    }

    [TestMethod]
    public async Task NoPlayerCanBeMadeOrUnlockedUnderAReservedName()
    {
        var access = Access();
        await FluentActions.Invoking(() => access.SetPasswordAsync("*admin*", "attack123")).Should().ThrowAsync<ArgumentException>();
        (await access.UnlockAsync("*admin*", "attack123")).Should().BeNull();
        (await access.UnlockAsync($"#campaign:{Guid.NewGuid():N}", "attack123")).Should().BeNull();
    }

    [TestMethod]
    public void ACampaignToken_OpensOnlyItsCampaign_AndTheDmOpensEvery()
    {
        var access = Access();
        var strahd = Guid.NewGuid();
        var other = Guid.NewGuid();
        var token = access.IssueCampaignToken(strahd);

        access.HasCampaignToken(token, strahd).Should().BeTrue();
        access.HasCampaignToken(token, other).Should().BeFalse();
        access.HasAdminToken(token).Should().BeFalse();
        access.HasToken(token, "C Hassapis").Should().BeFalse();
        access.HasCampaignToken(access.UnlockAdmin("x") ?? access.IssueToken("*admin*"), other).Should().BeTrue();
    }

    [TestMethod]
    public void APartyHoldsTwentyCharacters_EachOnce()
    {
        var campaign = Campaign.Create("Curse of Strahd");
        var mira = Guid.NewGuid();
        campaign.Join(mira).Should().BeTrue();
        campaign.Join(mira).Should().BeTrue();
        campaign.Party.Should().HaveCount(1);
        for (var i = 0; i < 19; i++) campaign.Join(Guid.NewGuid());
        campaign.Join(Guid.NewGuid()).Should().BeFalse();
        campaign.Leave(mira);
        campaign.Party.Should().HaveCount(19);
    }
}
