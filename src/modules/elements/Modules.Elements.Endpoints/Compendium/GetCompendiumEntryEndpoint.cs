using FastEndpoints;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record GetCompendiumEntryRequest
{
    public Guid Id { get; set; }
}

public sealed record CompendiumElementReference(Guid Id, string Name, string Type);

/// <summary>
/// One rule of an element in display form. <c>Kind</c> is include, statistic or selection.
/// </summary>
public sealed record CompendiumRule
{
    public required string Kind { get; init; }
    public int Level { get; init; }
    public string? Name { get; init; }
    public string? Value { get; init; }
    public string? Bonus { get; init; }
    public string? ElementType { get; init; }
    public string? Supports { get; init; }
    public int? Quantity { get; init; }
    public CompendiumElementReference? Element { get; init; }
}

public sealed record CompendiumEntry
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }
    public required string Type { get; init; }
    public string? Source { get; init; }
    public string? AuroraId { get; init; }
    public string? AuroraType { get; init; }
    public string Description { get; init; } = string.Empty;
    public IReadOnlyCollection<string> Supports { get; init; } = [];
    public List<CompendiumRule> Rules { get; init; } = [];
}

/// <summary>
/// An element with its description, source and rules (include targets resolved to names).
/// </summary>
public sealed class GetCompendiumEntryEndpoint : Endpoint<GetCompendiumEntryRequest, CompendiumEntry>
{
    private readonly IPersistence _persistence;

    public GetCompendiumEntryEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("/compendium/{id:guid}");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(GetCompendiumEntryRequest req, CancellationToken ct)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(req.Id);

        if (element is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var rules = new List<CompendiumRule>();
        foreach (var component in element.Components)
        {
            switch (component)
            {
                case IncludeRuleComponent include:
                    var target = await repository.GetElementAsync(include.IncludeElement);
                    rules.Add(new CompendiumRule
                    {
                        Kind = "include",
                        Level = include.LevelRequirement,
                        Element = target is null ? null : new CompendiumElementReference(target.Id, target.Name, target.Type)
                    });
                    break;

                case StatisticRuleComponent stat:
                    rules.Add(new CompendiumRule
                    {
                        Kind = "statistic",
                        Level = stat.LevelRequirement,
                        Name = stat.DisplayName ?? stat.Name,
                        Value = stat.Value,
                        Bonus = stat.StackingBonus
                    });
                    break;

                case SelectionRuleComponent select:
                    rules.Add(new CompendiumRule
                    {
                        Kind = "selection",
                        Level = select.LevelRequirement,
                        Name = select.Name,
                        ElementType = select.ElementType,
                        Supports = select.Supports,
                        Quantity = select.Quantity
                    });
                    break;
            }
        }

        var aurora = element.GetComponent<AuroraSourceComponent>();

        await Send.OkAsync(new CompendiumEntry
        {
            Id = element.Id,
            Name = element.Name,
            Type = element.Type,
            Source = aurora?.Source,
            AuroraId = aurora?.AuroraId,
            AuroraType = aurora?.AuroraType,
            Description = element.GetComponent<DescriptionComponent>()?.Content ?? string.Empty,
            Supports = element.GetComponent<SupportsComponent>()?.Supports ?? [],
            Rules = rules
        }, ct);
    }
}
