using System.Text.Json;
using System.Text.Json.Serialization;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record GetSpellIndexResponse(long Version, IReadOnlyList<SpellInfo> Spells);

/// <summary>
/// Every spell with its level, school, lists, ritual and concentration and casting figures, for the Magic tab (the
/// spells a cleric can prepare, a wizard's rituals). Compact and cached per content version, with an ETag.
/// </summary>
public sealed class GetSpellIndexEndpoint : EndpointWithoutRequest
{
    private static readonly JsonSerializerOptions Compact = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault,
    };

    private static (long Version, string Json)? _cache;

    private readonly ISpellIndex _spells;

    public GetSpellIndexEndpoint(ISpellIndex spells)
    {
        _spells = spells;
    }

    public override void Configure()
    {
        Get("/spell-index");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var snapshot = await _spells.GetAsync(ct);
        var etag = $"\"spells-{snapshot.Version}-{Environment.ProcessId}\"";
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
            cache = (snapshot.Version, JsonSerializer.Serialize(new GetSpellIndexResponse(snapshot.Version, snapshot.Spells), Compact));
            _cache = cache;
        }
        await Send.StringAsync(cache.Value.Json, contentType: "application/json", cancellation: ct);
    }
}
