namespace Starlights.Modules.Elements.Integration.Models.Rules;

/// <summary>
/// The DTO model for a selection rule.
/// </summary>
/// <param name="Supports">Optional Aurora-style supports expression that narrows the options of <paramref name="ElementType"/>.</param>
public record SelectionRuleDataModel(Guid RuleId, string ElementType, string Name, int LevelRequirement, string? Supports = null);