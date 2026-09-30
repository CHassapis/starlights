namespace Starlights.Modules.Elements.Integration.Models.Rules;

/// <summary>
/// The DTO model for a selection rule.
/// </summary>
/// <param name="Quantity">How many elements can be chosen; the builder creates one slot per pick.</param>
/// <param name="Supports">Optional Aurora-style supports expression that narrows the options of <paramref name="ElementType"/>.</param>
public record SelectionRuleDataModel(Guid RuleId, string ElementType, string Name, int LevelRequirement, string? Supports = null, int Quantity = 1, string? Requirements = null, bool Optional = false);