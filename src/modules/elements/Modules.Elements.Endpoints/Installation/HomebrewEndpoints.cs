using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using FastEndpoints;
using Microsoft.Extensions.Configuration;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Installation;

/// <summary>
/// Homebrew content: Aurora element files (.xml) kept in a folder (Aurora:HomebrewPath) and imported under the
/// "homebrew" sources group. Listing is open; uploading and deleting need the admin key or password.
/// </summary>
internal static partial class HomebrewFiles
{
    public static string Folder(IConfiguration config) => config["Aurora:HomebrewPath"] ?? "/data/homebrew";

    [GeneratedRegex("[^a-z0-9._-]+")]
    private static partial Regex Unsafe();

    public static string SafeName(string fileName)
    {
        var name = Unsafe().Replace(Path.GetFileNameWithoutExtension(fileName).ToLowerInvariant(), "-").Trim('-', '.');
        return (name.Length == 0 ? "homebrew" : name[..Math.Min(name.Length, 80)]) + ".xml";
    }

    public static IEnumerable<XElement> Elements(XDocument document) =>
        document.Descendants("element").Where(e => e.Attribute("id") is not null && e.Attribute("name") is not null && e.Attribute("type") is not null);
}

public sealed record HomebrewElementModel(string Name, string Type, string? Source);

public sealed record HomebrewFileModel(string File, List<HomebrewElementModel> Elements, List<string>? AppendTargets = null);

public sealed record GetHomebrewResponse(List<HomebrewFileModel> Files);

public sealed class GetHomebrewEndpoint : EndpointWithoutRequest<GetHomebrewResponse>
{
    public override void Configure()
    {
        Get("/homebrew");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var folder = HomebrewFiles.Folder(Config);
        var files = new List<HomebrewFileModel>();
        if (Directory.Exists(folder))
        {
            // the magic items made on the page are edited there, not as a file
            foreach (var path in Directory.EnumerateFiles(folder, "*.xml").Where(p => !HomebrewContent.IsManaged(Path.GetFileName(p))).Order())
            {
                try
                {
                    var document = XDocument.Load(path);
                    files.Add(new HomebrewFileModel(Path.GetFileName(path), HomebrewFiles.Elements(document)
                        .Select(e => new HomebrewElementModel((string)e.Attribute("name")!, (string)e.Attribute("type")!, (string?)e.Attribute("source")))
                        .ToList(), HomebrewUploadXml.AppendTargets(document)));
                }
                catch (XmlException)
                {
                    files.Add(new HomebrewFileModel(Path.GetFileName(path), []));
                }
            }
        }

        await Send.OkAsync(new GetHomebrewResponse(files), ct);
    }
}

public sealed record UploadHomebrewRequest
{
    public string FileName { get; init; } = string.Empty;

    /// <summary>The Aurora element XML.</summary>
    public string Content { get; init; } = string.Empty;
}

public sealed class UploadHomebrewEndpoint : Endpoint<UploadHomebrewRequest>
{
    private readonly IAuroraImporter _importer;

    public UploadHomebrewEndpoint(IAuroraImporter importer)
    {
        _importer = importer;
    }

    public override void Configure()
    {
        Post("/homebrew");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(UploadHomebrewRequest req, CancellationToken ct)
    {
        if (req.Content.Length > 5_000_000)
        {
            AddError(r => r.Content, "A homebrew file can be at most 5 MB.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        XDocument document;
        try
        {
            // XDocument.Parse refuses DTDs, so no entity tricks
            document = XDocument.Parse(req.Content);
        }
        catch (XmlException ex)
        {
            AddError(r => r.Content, $"This is not valid XML: {ex.Message}");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        if (HomebrewUploadXml.Validate(document) is { } validationError)
        {
            AddError(r => r.Content, validationError);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var folder = HomebrewFiles.Folder(Config);
        Directory.CreateDirectory(folder);
        var name = HomebrewFiles.SafeName(req.FileName);
        if (HomebrewContent.IsManaged(name))
        {
            AddError(r => r.FileName, "That name is kept for what the Homebrew page makes (items, spells, subclasses, classes); rename the file.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            var result = await HomebrewFileChange.ApplyAsync(Path.Combine(folder, name), document,
                () => _importer.ImportAsync(AuroraImporterIndex.Homebrew, replace: false, update: true, ct));
            await Send.OkAsync(new { File = name, result.ElementsImported, result.ElementsReplaced, result.Warnings }, ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}

public sealed class DeleteHomebrewEndpoint : EndpointWithoutRequest
{
    private readonly IAuroraImporter _importer;

    public DeleteHomebrewEndpoint(IAuroraImporter importer)
    {
        _importer = importer;
    }

    public override void Configure()
    {
        Delete("/homebrew/{file}");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var name = HomebrewFiles.SafeName(Route<string>("file") ?? string.Empty);
        var path = Path.Combine(HomebrewFiles.Folder(Config), name);
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            if (!File.Exists(path) || HomebrewContent.IsManaged(name))
            {
                await Send.NotFoundAsync(ct);
                return;
            }

            var result = await HomebrewFileChange.ApplyAsync(path, null, async () =>
            {
                var removed = await _importer.RemoveAsync("homebrew/" + name, ct);
                // Removal and rebuilding remaining patches commit together.
                var imported = await _importer.ImportAsync(AuroraImporterIndex.Homebrew, replace: false, update: true, ct);
                return new { Removed = removed, imported.Warnings };
            });
            await Send.OkAsync(result, ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}
