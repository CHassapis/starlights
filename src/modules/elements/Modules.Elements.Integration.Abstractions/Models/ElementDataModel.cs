using Starlights.Modules.Elements.Integration.Models.Rules;

namespace Starlights.Modules.Elements.Integration.Models;

/// <summary>
/// The DTO model for an Element with its associated data.
/// </summary>
public record ElementDataModel
{
    public Guid Id { get; init; } = Guid.Empty;
    public string Name { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;

    public List<IncludeRuleDataModel> IncludeRules { get; init; } = [];
    public List<StatisticRuleDataModel> StatisticRules { get; init; } = [];
    public List<SelectionRuleDataModel> SelectionRules { get; init; } = [];

    /// <summary>What it asks of the character, in words ("Strength 13 or Dexterity 13"), and as a requirements expression.</summary>
    public string? Prerequisite { get; init; }
    public string? PrerequisiteRequirements { get; init; }
}
