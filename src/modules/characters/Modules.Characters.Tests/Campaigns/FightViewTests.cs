using System.Text.Json.Nodes;
using AwesomeAssertions;
using Starlights.Modules.Characters.Services.Campaigns;

namespace Starlights.Modules.Characters.Tests.Campaigns;

/// <summary>What players see of an encounter being run: never a monster's hit points, notes or hidden creatures.</summary>
[TestClass]
public class FightViewTests
{
    private static JsonObject Sample(bool shareStats = false) => FightView.Parse($$"""
        {"revision":3,"active":true,"round":2,"turn":"m2","shareStats":{{(shareStats ? "true" : "false")}},
         "combatants":[
           {"id":"p1","kind":"pc","characterId":"0d6e1d8a-1f7e-4c4e-9d55-3a1c1b0e0001","name":"Ash","initiative":17,"conditions":[]},
           {"id":"m1","kind":"monster","name":"Pale stranger","initiative":12,"hp":30,"maxHp":82,"ac":16,"saves":{"wis":5},"notes":"really a vampire spawn","link":{"category":"bestiary","key":"vampire spawn_mm"},"conditions":[{"name":"Frightened","by":"Ash"}]},
           {"id":"m2","kind":"monster","name":"Wolf in the trees","initiative":15,"hp":11,"maxHp":11,"ac":13,"hidden":true,"conditions":[]}
         ]}
        """);

    [TestMethod]
    public void Players_SeeHowHurt_NotHitPoints_NotesOrWhatItIs()
    {
        var view = FightView.ForPlayers(Sample());
        var text = view.ToJsonString();
        text.Should().NotContain("82").And.NotContain("vampire").And.NotContain("\"hp\"").And.NotContain("\"ac\"").And.NotContain("saves");
        var monster = view["combatants"]!.AsArray()[1]!.AsObject();
        monster["health"]!.GetValue<string>().Should().Be("bloodied");
        monster["conditions"]!.AsArray().Should().HaveCount(1);
    }

    [TestMethod]
    public void HiddenCreatures_AreLeftOut_AndTheirTurnIsNotShown()
    {
        var view = FightView.ForPlayers(Sample());
        view["combatants"]!.AsArray().Should().HaveCount(2);
        view.ToJsonString().Should().NotContain("Wolf");
        view["turn"].Should().BeNull();
    }

    [TestMethod]
    public void ArmorClassAndSaves_OnlyWhenTheDmSharesThem()
    {
        var monster = FightView.ForPlayers(Sample(shareStats: true))["combatants"]!.AsArray()[1]!.AsObject();
        monster["ac"]!.GetValue<int>().Should().Be(16);
        monster["saves"]!["wis"]!.GetValue<int>().Should().Be(5);
        monster.ContainsKey("hp").Should().BeFalse();
    }

    [TestMethod]
    public void Mark_PutsOnAndTakesOffKnownConditions_OnVisibleCreaturesOnly()
    {
        var fight = Sample();
        FightView.Mark(fight, "m1", "faerie fire", on: true, by: "Ash").Should().BeTrue();
        fight["combatants"]!.AsArray()[1]!["conditions"]!.AsArray().Should().HaveCount(2);
        FightView.Mark(fight, "m1", "Frightened", on: false, by: "Ash").Should().BeTrue();
        fight["combatants"]!.AsArray()[1]!["conditions"]!.AsArray().Should().HaveCount(1);
        FightView.Mark(fight, "m2", "Prone", on: true, by: "Ash").Should().BeFalse();
        FightView.Mark(fight, "m1", "Dead drunk", on: true, by: "Ash").Should().BeFalse();
    }

    [TestMethod]
    public void Validate_RefusesDuplicateIdsAndNamelessCreatures()
    {
        FightView.Validate(Sample()).Should().BeNull();
        FightView.Validate(FightView.Parse("""{"combatants":[{"id":"a","name":"x"},{"id":"a","name":"y"}]}""")).Should().NotBeNull();
        FightView.Validate(FightView.Parse("""{"combatants":[{"id":"a"}]}""")).Should().NotBeNull();
    }

    [TestMethod]
    [DataRow(11, 11, "unhurt")]
    [DataRow(8, 11, "hurt")]
    [DataRow(5, 11, "bloodied")]
    [DataRow(0, 11, "down")]
    public void Health_InWords(int hp, int max, string expected) => FightView.Health(hp, max).Should().Be(expected);
}
