using System.Text.RegularExpressions;
using FastEndpoints;

namespace Starlights.Modules.Characters.Endpoints.Characters.Sheets;

/// <summary>
/// Serves the character sheet templates (the Aurora sheet PDFs and their fonts) from a read-only folder
/// (Sheets:TemplatesPath, default /data/aurora-sheets) that lives outside the repository. The browser fills them
/// in to make the downloadable sheet. Only plain file names from that one folder are served.
/// </summary>
public sealed partial class SheetTemplatesEndpoint : EndpointWithoutRequest
{
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|otf|ttf)$")]
    private static partial Regex FileName();

    public override void Configure()
    {
        Get("sheet-templates/{file}");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var name = Route<string>("file") ?? string.Empty;
        var folder = Config["Sheets:TemplatesPath"] ?? "/data/aurora-sheets";
        var path = Path.Combine(folder, name);
        if (!FileName().IsMatch(name) || name.Contains("..", StringComparison.Ordinal) || !File.Exists(path))
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var contentType = Path.GetExtension(name) switch
        {
            ".pdf" => "application/pdf",
            ".otf" => "font/otf",
            _ => "font/ttf",
        };
        HttpContext.Response.Headers.CacheControl = "public, max-age=86400";
        await Send.FileAsync(new FileInfo(path), contentType, cancellation: ct);
    }
}
