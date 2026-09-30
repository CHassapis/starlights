using Starlights.Modules.Characters.Domain.Abilities;
using Starlights.Modules.Characters.Domain.SavingThrows;

namespace Starlights.Modules.Characters.Services.Statistics.Processors;

internal sealed class SavingThrowStatisticsPostProcessor : IStatisticsPostProcessor
{
    public int Order => 10; // after proficiency and abilities

    public void Process(StatisticsProcessorContext context)
    {
        var abilities = context.Character.GetRequiredComponent<AbilitiesComponent>();
        context.Character.UpdateComponent<SavingThrowsComponent>((component, _) =>
        {
            // the ability modifier in the same pass as the bonuses, so a recalculation is complete by itself (it used
            // to wait for the ability-changed event, which could leave saves behind when an item came off)
            foreach (var ability in abilities.AbilityScores)
            {
                component.UpdateAbilityScoreModifier(ability.Id, ability.CalculatedModifier);
            }

            foreach (var save in component.SavingThrows)
            {
                // we can't just use "strength" here because to would clash with abilities, so we use full "strength-saving-throw" for now
                var slug = $"{save.Name.ToSlug()}";

                var additionalBonus = context.Statistics.GetGroupSum($"{slug}:proficiency");
                additionalBonus += context.Statistics.GetGroupSum($"{slug}:misc");

                save.UpdateAdditionalBonus(additionalBonus);
            }
        });
    }
}