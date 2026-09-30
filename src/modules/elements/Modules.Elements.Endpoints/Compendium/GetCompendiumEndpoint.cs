using FastEndpoints;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record CompendiumListItem(Guid Id, string Name, string Type, string? Source);

public sealed record GetCompendiumResponse(List<CompendiumListItem> Items);

/// <summary>
/// Lightweight list of every element (no descriptions) for the compendium's search and filters.
/// </summary>
public sealed class GetCompendiumEndpoint : EndpointWithoutRequest<GetCompendiumResponse>
{
    private readonly IPersistence _persistence;

    public GetCompendiumEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("/compendium");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var elements = await repository.GetElementsAsync();

        var items = elements
            .Select(e => new CompendiumListItem(e.Id, e.Name, e.Type, e.GetComponent<AuroraSourceComponent>()?.Source))
            .OrderBy(x => x.Name)
            .ThenBy(x => x.Type)
            .ToList();

        await Send.OkAsync(new GetCompendiumResponse(items), ct);
    }
}
