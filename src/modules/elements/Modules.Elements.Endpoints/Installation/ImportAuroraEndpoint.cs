using FastEndpoints;
using Microsoft.Extensions.Logging;
using Starlights.Modules.Elements.Domain;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Installation;

public sealed record ImportAuroraRequest
{
    /// <summary>
    /// The Aurora .index file to import, relative to the content repository root.
    /// </summary>
    public string Index { get; init; } = "core/players-handbook-2024.index";

    /// <summary>
    /// Re-create all elements that were imported before (e.g. after an importer change).
    /// </summary>
    public bool Replace { get; init; }

    /// <summary>
    /// Re-create only the elements whose Aurora XML changed upstream (what the nightly update uses).
    /// </summary>
    public bool Update { get; init; }
}

/// <summary>
/// Imports Aurora content from the local content repository, e.g.
/// <c>POST /api/elements/import-aurora {"index": "core/players-handbook-2024.index"}</c>.
/// Safe to re-run: without <c>replace</c> it only adds elements that are not there yet.
/// </summary>
public class ImportAuroraEndpoint : Endpoint<ImportAuroraRequest>
{
    private readonly ILogger<ImportAuroraEndpoint> _logger;
    private readonly IAuroraImporter _importer;

    public ImportAuroraEndpoint(ILogger<ImportAuroraEndpoint> logger, IAuroraImporter importer)
    {
        _logger = logger;
        _importer = importer;
    }

    public override void Configure()
    {
        Post("/import-aurora");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(ImportAuroraRequest req, CancellationToken ct)
    {
        using var _ = ElementsInstrumentation.StartActivity();

        _logger.LogInformation("importing aurora index '{Index}'...", req.Index);

        try
        {
            var result = await _importer.ImportAsync(req.Index, req.Replace, req.Update, ct);
            await Send.OkAsync(result, ct);
        }
        catch (FileNotFoundException ex)
        {
            AddError(ex.Message);
            await Send.ErrorsAsync(cancellation: ct);
        }
    }
}

public sealed record RemoveAuroraRequest
{
    /// <summary>
    /// Remove the elements imported from Aurora files under this path, e.g. "unearthed-arcana/".
    /// </summary>
    public string PathPrefix { get; init; } = string.Empty;
}

/// <summary>
/// Removes imported Aurora content by folder: <c>POST /api/elements/remove-aurora {"pathPrefix": "unearthed-arcana/"}</c>.
/// Pair it with Aurora:Exclude so later imports leave the folder out.
/// </summary>
public class RemoveAuroraEndpoint : Endpoint<RemoveAuroraRequest>
{
    private readonly IAuroraImporter _importer;

    public RemoveAuroraEndpoint(IAuroraImporter importer)
    {
        _importer = importer;
    }

    public override void Configure()
    {
        Post("/remove-aurora");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(RemoveAuroraRequest req, CancellationToken ct)
    {
        if (req.PathPrefix.Trim().Length < 3)
        {
            AddError(r => r.PathPrefix, "Give the folder to remove, e.g. \"unearthed-arcana/\".");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var removed = await _importer.RemoveAsync(req.PathPrefix.Trim(), ct);
        await Send.OkAsync(new { Removed = removed }, ct);
    }
}
