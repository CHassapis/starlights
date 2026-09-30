using AwesomeAssertions;
using Starlights.Modules.Characters.Domain.Abilities;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Registrations;
using Starlights.Modules.Characters.Domain.Elements;

namespace Starlights.Modules.Characters.Tests.Characters;

[TestClass]
public class AbilityScoreConsistencyTests
{
    [TestMethod]
    public void AStoredTotalThatDoesNotAddUp_IsRepairedByTheNextCalculation()
    {
        // Arrange: Charisma base 13 + 1, but the stored total says 11 (a lost update between two writers)
        var character = Character.Create("Vesper");
        var abilities = AbilitiesComponent.Create(character.Id);
        character.AddComponent(abilities);
        var registration = Registration.Create(character.Id, new ElementId(Guid.NewGuid()), "Charisma", "Ability");
        var charisma = abilities.CreateAbilityScore(registration.Id, "Charisma", "CHA", 0);
        abilities.UpdateAbilityBaseScore(charisma.Id, 13);
        abilities.UpdateAbilityAdditionalScore(charisma.Id, 1);
        typeof(AbilityScore).GetProperty(nameof(AbilityScore.CalculatedScore))!.SetValue(charisma, 11);

        // Act: the calculation sets the same bonus again
        abilities.UpdateAbilityAdditionalScore(charisma.Id, 1);

        // Assert
        charisma.CalculatedScore.Should().Be(14);
        charisma.CalculatedModifier.Should().Be(2);
    }
}
