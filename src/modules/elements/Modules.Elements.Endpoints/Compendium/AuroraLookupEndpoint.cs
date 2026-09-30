using FastEndpoints;
using Starlights.Modules.Elements.Data;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record AuroraLookupRequest
{
    public List<string> Ids { get; init; } = [];
}

public sealed record AuroraLookupResponse(Dictionary<string, Guid> Elements);

/// <summary>
/// Maps Aurora element ids (as in a .dnd5e character file) to the imported elements; ids that were not
/// imported (homebrew, excluded content) are left out. POST only because the list can be long.
/// </summary>
public sealed class AuroraLookupEndpoint : Endpoint<AuroraLookupRequest, AuroraLookupResponse>
{
    private readonly IPersistence _persistence;

    public AuroraLookupEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Post("/aurora-lookup");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(AuroraLookupRequest req, CancellationToken ct)
    {
        var ids = req.Ids.Where(id => !string.IsNullOrWhiteSpace(id)).Take(5000).ToList();
        var found = await _persistence.GetRepository<IElementsRepository>().GetElementIdsByAuroraIdsAsync(ids);
        await Send.OkAsync(new AuroraLookupResponse(found), ct);
    }
}
