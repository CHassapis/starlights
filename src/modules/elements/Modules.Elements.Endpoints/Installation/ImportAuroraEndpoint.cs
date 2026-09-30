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
}

/// <summary>
/// Imports Aurora content from the local content repository, e.g.
/// <c>POST /api/elements/import-aurora?index=core/players-handbook-2024.index</c>. Safe to re-run.
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
            var result = await _importer.ImportAsync(req.Index, ct);
            await Send.OkAsync(result, ct);
        }
        catch (FileNotFoundException ex)
        {
            AddError(ex.Message);
            await Send.ErrorsAsync(cancellation: ct);
        }
    }
}
