using System.Xml.Linq;
using FastEndpoints;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Endpoints.Compendium;

public sealed record GetCompendiumBatchRequest
{
    /// <summary>Comma-separated element ids (at most 300).</summary>
    [QueryParam]
    public string Ids { get; init; } = string.Empty;
}

public sealed record SheetDescription(int Level, string? Usage, string Text);

/// <summary>
/// Aurora's &lt;sheet&gt;: the short text a character sheet shows for a feature (per level), with the name,
/// action and usage it is listed under. Texts can hold {{statistic}} placeholders.
/// </summary>
public sealed record SheetInfo(bool Display, string? Alt, string? Action, string? Usage, List<SheetDescription> Descriptions);

public sealed record CompendiumBatchEntry
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }
    public required string Type { get; init; }
    public string? Source { get; init; }
    public string Description { get; init; } = string.Empty;
    public Dictionary<string, string> Setters { get; init; } = [];
    public CompendiumSpellcasting? Spellcasting { get; init; }
    public SheetInfo? Sheet { get; init; }
}

public sealed record GetCompendiumBatchResponse(List<CompendiumBatchEntry> Entries);

/// <summary>
/// Several elements at once for a character sheet: description, setters, spellcasting and sheet text.
/// </summary>
public sealed class GetCompendiumBatchEndpoint : Endpoint<GetCompendiumBatchRequest, GetCompendiumBatchResponse>
{
    private readonly IPersistence _persistence;

    public GetCompendiumBatchEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("/compendium/batch");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(GetCompendiumBatchRequest req, CancellationToken ct)
    {
        var ids = req.Ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => Guid.TryParse(s, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .Take(300)
            .ToList();

        var elements = await _persistence.GetRepository<IElementsRepository>().GetElementsByIdsAsync(ids);

        var entries = elements.ConvertAll(element =>
        {
            var aurora = element.GetComponent<AuroraSourceComponent>();
            return new CompendiumBatchEntry
            {
                Id = element.Id,
                Name = element.Name,
                Type = element.Type,
                Source = aurora?.Source,
                Description = element.GetComponent<DescriptionComponent>()?.Content ?? string.Empty,
                Setters = aurora is null ? [] : GetCompendiumEntryEndpoint.ParseSetters(aurora.RawXml),
                Spellcasting = aurora is null ? null : GetCompendiumEntryEndpoint.ParseSpellcasting(aurora.RawXml),
                Sheet = aurora is null ? null : ParseSheet(aurora.RawXml),
            };
        });

        await Send.OkAsync(new GetCompendiumBatchResponse(entries), ct);
    }

    private static SheetInfo? ParseSheet(string rawXml)
    {
        try
        {
            var sheet = XElement.Parse(rawXml).Element("sheet");
            if (sheet is null)
            {
                return null;
            }

            var descriptions = sheet.Elements("description")
                .Select(d => new SheetDescription(int.TryParse((string?)d.Attribute("level"), out var level) ? level : 1, (string?)d.Attribute("usage"), d.Value.Trim()))
                .Where(d => d.Text.Length > 0)
                .ToList();

            return new SheetInfo(
                !string.Equals((string?)sheet.Attribute("display"), "false", StringComparison.OrdinalIgnoreCase),
                (string?)sheet.Attribute("alt"),
                (string?)sheet.Attribute("action"),
                (string?)sheet.Attribute("usage"),
                descriptions);
        }
        catch (System.Xml.XmlException)
        {
            return null;
        }
    }
}
