namespace Starlights.Modules.Elements.Integration.Models.Rules;

/// <summary>
/// The DTO model for an include rule.
/// </summary>
/// <param name="Requirements">Optional condition (Aurora requirements with element ids), see the character processor.</param>
public record IncludeRuleDataModel(Guid RuleId, Guid IncludedElementId, int LevelRequirement, string? Requirements = null);
