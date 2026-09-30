using FastEndpoints;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record GetOrganizationsResponse(List<LoreEntry> Organizations);

/// <summary>
/// Organizations a character can belong to, with their write-ups (from the 5etools data; the Aurora content
/// has none). Empty when the 5etools data is not installed.
/// </summary>
public sealed class GetOrganizationsEndpoint : EndpointWithoutRequest<GetOrganizationsResponse>
{
    private readonly IFiveEToolsLore _lore;

    public GetOrganizationsEndpoint(IFiveEToolsLore lore)
    {
        _lore = lore;
    }

    public override void Configure()
    {
        Get("/lore/organizations");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var organizations = _lore.Available ? _lore.GetOrganizations().ToList() : [];
        HttpContext.Response.Headers.CacheControl = "public, max-age=3600";
        await Send.OkAsync(new GetOrganizationsResponse(organizations), ct);
    }
}
