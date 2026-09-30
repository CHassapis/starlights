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

    /// <summary>The element's Aurora id (ID_…), to match Aurora references such as a weapon's proficiency.</summary>
    public string? AuroraId { get; init; }

    /// <summary>Aurora's &lt;supports&gt; tags (weapon category, properties, damage type, …).</summary>
    public List<string> Supports { get; init; } = [];

    /// <summary>
    /// The element's &lt;stat&gt; rules as Aurora wrote them (for items: what they add while equipped or attuned,
    /// such as ac:misc for a Cloak of Protection).
    /// </summary>
    public List<CompendiumStat> Stats { get; init; } = [];

    public string Description { get; init; } = string.Empty;
    public Dictionary<string, string> Setters { get; init; } = [];
    public CompendiumSpellcasting? Spellcasting { get; init; }
    public SheetInfo? Sheet { get; init; }
}

public sealed record CompendiumStat(string Name, string Value, string? Bonus, string? Equipped, string? Requirements);

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
                AuroraId = aurora?.AuroraId,
                Supports = aurora is null ? [] : ParseSupports(aurora.RawXml),
                Stats = aurora is null || !ItemTypes.Contains(element.Type) ? [] : ParseStats(aurora.RawXml),
                Description = element.GetComponent<DescriptionComponent>()?.Content ?? string.Empty,
                Setters = aurora is null ? [] : GetCompendiumEntryEndpoint.ParseSetters(aurora.RawXml),
                Spellcasting = aurora is null ? null : GetCompendiumEntryEndpoint.ParseSpellcasting(aurora.RawXml),
                Sheet = aurora is null ? null : ParseSheet(aurora.RawXml),
            };
        });

        await Send.OkAsync(new GetCompendiumBatchResponse(entries), ct);
    }

    // stat rules are only sent for items: for everything else the character's statistics already hold them
    private static readonly HashSet<string> ItemTypes = ["Item", "Weapon", "Armor", "Magic Item"];

    private static List<CompendiumStat> ParseStats(string rawXml)
    {
        try
        {
            return XElement.Parse(rawXml).Element("rules")?.Elements("stat")
                .Where(s => s.Attribute("name") is not null && s.Attribute("value") is not null)
                .Select(s => new CompendiumStat(
                    (string)s.Attribute("name")!,
                    (string)s.Attribute("value")!,
                    (string?)s.Attribute("bonus"),
                    (string?)s.Attribute("equipped"),
                    (string?)s.Attribute("requirements")))
                .ToList() ?? [];
        }
        catch (System.Xml.XmlException)
        {
            return [];
        }
    }

    private static List<string> ParseSupports(string rawXml)
    {
        try
        {
            return (XElement.Parse(rawXml).Element("supports")?.Value ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();
        }
        catch (System.Xml.XmlException)
        {
            return [];
        }
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
