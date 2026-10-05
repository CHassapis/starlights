using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Tests.Combat;

[TestClass]
public class CharacterCombatTests
{
    [TestMethod]
    public void A_fight_in_progress_is_valid()
    {
        new CharacterCombat
        {
            Damage = 12,
            TemporaryHitPoints = 5,
            HitDiceSpent = 2,
            Uses = new() { ["Second Wind"] = 1, ["Action Surge"] = 1 },
            Concentration = "Bless",
            Conditions = ["Prone", "Frightened"],
            Exhaustion = 1,
            DeathSaveSuccesses = 2,
            DeathSaveFailures = 1,
            Companions = [new CharacterCompanion { Id = "f1", Name = "Owl", Key = "owl_xmm", MaxHitPoints = 1, Damage = 1 }],
        }.Validate().Should().BeNull();
    }

    [TestMethod]
    public void Impossible_values_are_refused()
    {
        new CharacterCombat { Damage = -1 }.Validate().Should().NotBeNull();
        new CharacterCombat { Uses = new() { [""] = 1 } }.Validate().Should().NotBeNull();
        new CharacterCombat { Conditions = [new string('x', 61)] }.Validate().Should().NotBeNull();
        new CharacterCombat { DeathSaveFailures = 4 }.Validate().Should().NotBeNull();
        new CharacterCombat { Exhaustion = 11 }.Validate().Should().NotBeNull();
        new CharacterCombat { Companions = [new CharacterCompanion { Id = "a", Name = "" }] }.Validate().Should().NotBeNull();
        new CharacterCombat { Companions = [new CharacterCompanion { Id = "a", Name = "Owl", Damage = -1 }] }.Validate().Should().NotBeNull();
    }
}
