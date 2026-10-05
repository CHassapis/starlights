using FastEndpoints;
using Starlights.Modules.Elements.Data;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record SourceModel(string Name, string Group, int Elements);

public sealed record GetSourcesResponse(List<SourceModel> Sources);

/// <summary>
/// The source books of the imported content, grouped by the content repository's top folder (core,
/// supplements, unearthed-arcana, …) — what a character's Sources section lets you tick.
/// </summary>
public sealed class GetSourcesEndpoint : EndpointWithoutRequest<GetSourcesResponse>
{
    private static readonly string[] GroupOrder = ["core", "supplements", "collaborations", "5etools", "unearthed-arcana", "pull-requests"];

    private readonly IPersistence _persistence;

    public GetSourcesEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("/sources");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var rows = await _persistence.GetRepository<IElementsRepository>().GetAuroraSourcesAsync();

        static int Rank(string group) => Array.IndexOf(GroupOrder, group) is var i && i >= 0 ? i : GroupOrder.Length;

        var sources = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Source) && r.Source is not ("Internal" or "Starlights"))
            .GroupBy(r => r.Source!)
            .Select(g => new SourceModel(
                g.Key,
                // a book belongs to the folder most of its elements come from
                g.GroupBy(r => r.File.Split('/')[0]).OrderByDescending(f => f.Count()).First().Key,
                g.Count()))
            .OrderBy(s => Rank(s.Group))
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        await Send.OkAsync(new GetSourcesResponse(sources), ct);
    }
}
