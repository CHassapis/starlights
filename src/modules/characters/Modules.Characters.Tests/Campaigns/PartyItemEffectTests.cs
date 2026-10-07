using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>A magic item used on another party member: healing or temporary hit points, as the simulator does them.</summary>
[TestClass]
public class PartyItemEffectTests
{
    private static readonly Guid Healer = Guid.NewGuid();
    private static readonly Guid Hurt = Guid.NewGuid();

    private static Campaign Party()
    {
        var campaign = Campaign.Create("The test campaign");
        campaign.Join(Healer);
        campaign.Join(Hurt);
        return campaign;
    }

    [TestMethod]
    public void Healing_GivesBackHitPointsUpToTheMaximum_AndEndsTheDeathSaves()
    {
        var dying = new CharacterCombat { Damage = 30, DeathSaveSuccesses = 1, DeathSaveFailures = 2, TemporaryHitPoints = 0 };

        var healed = PartyItemEffect.Apply(dying, PartyItemEffect.Heal, 7);

        healed.Damage.Should().Be(23);
        healed.DeathSaveSuccesses.Should().Be(0);
        healed.DeathSaveFailures.Should().Be(0);
        PartyItemEffect.Apply(new CharacterCombat { Damage = 3 }, PartyItemEffect.Heal, 10).Damage.Should().Be(0);
    }

    [TestMethod]
    public void TemporaryHitPoints_DoNotAddUp_TheHigherStays()
    {
        PartyItemEffect.Apply(new CharacterCombat { TemporaryHitPoints = 4 }, PartyItemEffect.TemporaryHitPoints, 6).TemporaryHitPoints.Should().Be(6);
        PartyItemEffect.Apply(new CharacterCombat { TemporaryHitPoints = 8 }, PartyItemEffect.TemporaryHitPoints, 6).TemporaryHitPoints.Should().Be(8);
        PartyItemEffect.Apply(new CharacterCombat { Damage = 5 }, PartyItemEffect.TemporaryHitPoints, 6).Damage.Should().Be(5);
    }

    [TestMethod]
    public void EachEffect_CountsAsAChangeFromOutside_SoAnOpenSimulatorReloads()
    {
        var once = PartyItemEffect.Apply(new CharacterCombat(), PartyItemEffect.Heal, 2);
        PartyItemEffect.Apply(once, PartyItemEffect.TemporaryHitPoints, 2).Received.Should().Be(2);
    }

    [TestMethod]
    public void OnlyHealingOrTemporaryHitPoints_ForAnotherCharacterOfTheParty()
    {
        var party = Party();
        PartyItemEffect.Validate(party, Healer, Hurt, PartyItemEffect.Heal, 9).Should().BeNull();
        PartyItemEffect.Validate(party, Healer, Hurt, PartyItemEffect.TemporaryHitPoints, 1).Should().BeNull();
        PartyItemEffect.Validate(party, Healer, Hurt, "saveBonus", 3).Should().NotBeNull();
        PartyItemEffect.Validate(party, Healer, Hurt, null, 3).Should().NotBeNull();
        PartyItemEffect.Validate(party, Healer, Hurt, PartyItemEffect.Heal, 0).Should().NotBeNull();
        PartyItemEffect.Validate(party, Healer, Hurt, PartyItemEffect.Heal, PartyItemEffect.MaxAmount + 1).Should().NotBeNull();
        PartyItemEffect.Validate(party, Healer, Healer, PartyItemEffect.Heal, 5).Should().NotBeNull();
        PartyItemEffect.Validate(party, Healer, Guid.NewGuid(), PartyItemEffect.Heal, 5).Should().NotBeNull();
        PartyItemEffect.Validate(party, Guid.NewGuid(), Hurt, PartyItemEffect.Heal, 5).Should().NotBeNull();
    }

    [TestMethod]
    public void TheFightState_CountsOutsideChanges_AndChecksTheCount()
    {
        new CharacterCombat { Received = 3 }.Validate().Should().BeNull();
        new CharacterCombat { Received = -1 }.Validate().Should().NotBeNull();
    }
}
