using System.Text.Json;
using System.Text.Json.Serialization;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record GetItemsResponse(long Version, IReadOnlyList<ItemInfo> Items);

/// <summary>
/// Every item for the item picker and the inventory: categories, magic layer, base item rule, weapon, armor and
/// container figures, and what each does. Sent compact (empty and default fields left out) and cached per content
/// version; browsers revalidate with the ETag and get "304 Not Modified" until content changes.
/// </summary>
public sealed class GetItemsEndpoint : EndpointWithoutRequest
{
    private static readonly JsonSerializerOptions Compact = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault,
    };

    private static (long Version, string Json)? _cache;

    private readonly IItemCatalog _catalog;

    public GetItemsEndpoint(IItemCatalog catalog)
    {
        _catalog = catalog;
    }

    public override void Configure()
    {
        Get("/items");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var snapshot = await _catalog.GetAsync(ct);
        var etag = $"\"items-{snapshot.Version}-{Environment.ProcessId}\"";
        HttpContext.Response.Headers.ETag = etag;
        HttpContext.Response.Headers.CacheControl = "no-cache";
        if (HttpContext.Request.Headers.IfNoneMatch == etag)
        {
            await Send.ResultAsync(Results.StatusCode(StatusCodes.Status304NotModified));
            return;
        }

        var cache = _cache;
        if (cache?.Version != snapshot.Version)
        {
            cache = (snapshot.Version, JsonSerializer.Serialize(new GetItemsResponse(snapshot.Version, snapshot.Items), Compact));
            _cache = cache;
        }
        await Send.StringAsync(cache.Value.Json, contentType: "application/json", cancellation: ct);
    }
}

public sealed record GetBaseItemsResponse(IReadOnlyList<ItemInfo> Items);

/// <summary>The weapons or armor a magic item ("Weapon, +1", "Flame Tongue") can be made from.</summary>
public sealed class GetBaseItemsEndpoint : EndpointWithoutRequest<GetBaseItemsResponse>
{
    private readonly IItemCatalog _catalog;

    public GetBaseItemsEndpoint(IItemCatalog catalog)
    {
        _catalog = catalog;
    }

    public override void Configure()
    {
        Get("/items/{itemId:guid}/bases");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        await Send.OkAsync(new GetBaseItemsResponse(await _catalog.GetBaseCandidatesAsync(Route<Guid>("itemId"), ct)), ct);
    }
}
