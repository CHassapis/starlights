namespace Starlights.Modules.Characters.Endpoints.Models;

/// <summary>
/// The DTO model for a selection rule option.
/// </summary>
public record SelectionRuleOptionModel
{
    public required Guid ElementId { get; init; }
    public required string Name { get; init; }

    /// <summary>
    /// The source book, to tell apart options with the same name (e.g. the 2014 and 2024 Elf).
    /// </summary>
    public string? Source { get; init; }
}
