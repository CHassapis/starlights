using Starlights.Modules.Characters.Domain.Abilities;

namespace Starlights.Modules.Characters.Services.Statistics.Processors;

internal sealed class AbilitiesGroupProcessor : IStatisticGroupProcessor
{
    public int Order => 5;

    public void Process(Dictionary<string, StatisticRuleGroup> pendingGroups, StatisticsProcessorContext context, Func<StatisticRuleGroup, StatisticsProcessorContext, StatisticValuesGroup?> processGroupNode)
    {
        var component = context.Character.GetRequiredComponent<AbilitiesComponent>();

        // ensure ability score related groups are processed to completion: the bonuses, the maximum (20 unless
        // raised: strength:max, strength:max:extra) and a value the score is set to (strength:score:set, e.g.
        // Gauntlets of Ogre Power); the maximum and set groups used to be skipped when bonuses existed
        foreach (var score in component.AbilityScores)
        {
            var groupKey = score.Name.ToSlug();
            foreach (var key in new[] { groupKey, $"{groupKey}:max", $"{groupKey}:max:extra", $"{groupKey}:score:set" })
            {
                if (!pendingGroups.TryGetValue(key, out var pendingGroup))
                {
                    continue;
                }

                var result = processGroupNode(pendingGroup, context);
                if (result is StatisticValuesGroup group && group.IsCompleted)
                {
                    continue;
                }

                context.AddError($"Failed to process ability score group '{key}' - if this group has dependencies, those need to be processed first (recursively)");
                if (key == groupKey)
                {
                    throw new InvalidOperationException($"Failed to process ability score group '{key}' - if this group has dependencies, those need to be processed first (recursively)");
                }
            }
        }

        // update ability scores based on processed groups, like Aurora: base + bonuses, no higher than the maximum
        // (unless the base already is), and at least the value an item sets it to
        foreach (var score in component.AbilityScores)
        {
            var groupKey = score.Name.ToSlug();

            var bonuses = 0;
            if (context.Statistics.TryGetGroup(groupKey, out var abilityGroup))
            {
                if (abilityGroup.IsCompleted)
                {
                    bonuses = abilityGroup.Sum();
                }
                else
                {
                    context.AddError($"Ability score group '{groupKey}' is not completed");
                    // errors will be logged, but we still want to update as much as possible without failing completely
                }
            }

            var maximum = CompletedSum(context, $"{groupKey}:max") ?? 20;
            maximum += CompletedSum(context, $"{groupKey}:max:extra") ?? 0;

            var calculated = score.BaseScore + bonuses;
            if (calculated > maximum)
            {
                calculated = Math.Max(maximum, score.BaseScore);
            }
            if (context.Statistics.TryGetGroup($"{groupKey}:score:set", out var setGroup) && setGroup.IsCompleted
                && setGroup.GetStatisticValues().Select(v => v.Value).DefaultIfEmpty(0).Max() is var setTo && setTo > calculated)
            {
                calculated = setTo;
            }

            var newAdditionalScore = calculated - score.BaseScore;
            component.UpdateAbilityAdditionalScore(score.Id, newAdditionalScore);


            var scoreGroup = context.Statistics.WithGroup($"{groupKey}:score", group =>
            {
                group.WithValue(score.CalculatedScore, $"{score.Name}");
                group.Complete();
            });

            var modifierGroup = context.Statistics.WithGroup($"{groupKey}:modifier", group =>
            {
                group.WithValue(score.CalculatedModifier, $"{score.Name} Modifier");
                group.Complete();
            });

            context.Statistics.WithGroupVariants(scoreGroup.GroupName, score.Name);
            context.Statistics.WithGroupVariants(modifierGroup.GroupName, score.Name);
        }

    }

    private static int? CompletedSum(StatisticsProcessorContext context, string groupName) =>
        context.Statistics.TryGetGroup(groupName, out var group) && group.IsCompleted ? group.Sum() : null;
}
