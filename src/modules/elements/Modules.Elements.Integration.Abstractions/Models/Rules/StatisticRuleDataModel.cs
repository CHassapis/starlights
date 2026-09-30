namespace Starlights.Modules.Elements.Integration.Models.Rules;

/// <summary>
/// The DTO model for a statistic rule.
/// </summary>
/// <param name="Requirements">Optional condition (Aurora requirements with element ids), see the character processor.</param>
public record StatisticRuleDataModel(Guid RuleId, string Name, string Value, string? StackingBonus, int LevelRequirement, string? Requirements = null);
