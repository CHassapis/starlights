using System.Text.Json;
using Starlights.Modules.Characters.Domain.Campaigns;

namespace Starlights.Modules.Characters.Services.Campaigns;

/// <summary>The campaign itself in an export: its settings, with only whether it has passwords, never their hashes.</summary>
public sealed record ExportedCampaign(
    Guid Id,
    string Name,
    string Description,
    string? CoverUrl,
    IReadOnlyList<Guid> Party,
    string? DmName,
    bool UseHomebrew,
    bool HasPassword,
    bool HasDmPassword,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>An entry as the DM has it (notes, details, and an encounter's fight), in the database's own terms.</summary>
public sealed record ExportedEntry(
    Guid Id,
    string Kind,
    string Title,
    int? Number,
    string? OccurredOn,
    bool Visible,
    string Body,
    string DmNotes,
    string? ImageUrl,
    JsonElement Data,
    int Sort,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    JsonElement? Fight);

/// <summary>
/// A party member: all of the character (its rows in every table, as the builder's Save/Discard captures them, and
/// its fight state), or, when its player locked it and the reader lacks that player's token, only its name and
/// player, as the campaign page shows it; Missing when the character was deleted.
/// </summary>
public sealed record ExportedCharacter(
    Guid Id,
    string Name,
    string? PlayerName,
    bool Locked,
    bool Missing,
    int? Level = null,
    string? Build = null,
    string? PortraitUrl = null,
    JsonElement? Combat = null,
    JsonElement? Rows = null);

/// <summary>A book or homebrew item the campaign's magic items are (data.elementId), with the entries that name it.</summary>
public sealed record ExportedItem(Guid ElementId, string Name, string? Source, string? AuroraId, IReadOnlyList<Guid> Entries);

/// <summary>A picture in the archive (Path) and the address the campaign and characters use for it (Url).</summary>
public sealed record ExportedFile(string Path, string Url);

/// <summary>campaign.json: everything of one campaign needed to read it again or rebuild it.</summary>
public sealed record CampaignExportDocument(
    string Format,
    int FormatVersion,
    DateTimeOffset ExportedAt,
    string? StarlightsVersion,
    ExportedCampaign Campaign,
    IReadOnlyList<ExportedEntry> Entries,
    IReadOnlyList<ExportedCharacter> Characters,
    IReadOnlyList<ItemHolder> Carried,
    IReadOnlyList<ExportedItem> Items,
    IReadOnlyList<ExportedFile> Files,
    IReadOnlyList<string> NotIncluded);

/// <summary>
/// The DM's export of a campaign (GET /campaigns/{id}/export): one .zip with campaign.json (this document) and the
/// campaign's pictures and the party's portraits. It holds what the DM may read and nothing secret; what it leaves
/// out on purpose is listed in the document itself (<see cref="NotIncluded"/>). There is no import yet.
/// </summary>
public static class CampaignExport
{
    public const string Format = "starlights-campaign-export";
    public const int FormatVersion = 1;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static readonly IReadOnlyList<string> NotIncluded =
    [
        "passwords: the campaign's, its DM password and the players' (only whether the campaign has them)",
        "unlock tokens and the server's keys and settings",
        "players' private notes (only their authors read them, not even the DM)",
        "the build of a character whose player locked it, unless the DM held that player's token when exporting",
        "the books' content (Aurora Legacy, 5etools): element ids and Compendium links point into it",
        "homebrew files: the items the campaign uses are listed by id, name and book",
        "other campaigns, and characters outside the party",
    ];

    public static ExportedCampaign Campaign(Campaign c) =>
        new(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.DmName, c.UseHomebrew, c.PasswordHash is not null, c.DmPasswordHash is not null, c.CreatedAt, c.UpdatedAt);

    /// <summary>Every entry as the DM reads it, except players' private notes, in the order the campaign shows them.</summary>
    public static List<ExportedEntry> Entries(IEnumerable<CampaignEntry> entries) =>
        entries
            .Where(e => e.Kind != CampaignEntry.Note || CampaignView.CanReadNote(e, dm: true, reader: null))
            .OrderBy(e => e.Kind, StringComparer.Ordinal).ThenBy(e => e.Number).ThenBy(e => e.Sort).ThenBy(e => e.CreatedAt)
            .Select(e => new ExportedEntry(e.Id, e.Kind, e.Title, e.Number, e.OccurredOn, e.Visible, e.Body, e.DmNotes, e.ImageUrl, Parse(e.Data),
                e.Sort, e.CreatedAt, e.UpdatedAt, e.Kind == "encounter" ? Parse(e.Fight) : null))
            .ToList();

    /// <summary>The content items the magic item entries name (data.elementId, data.baseElementId), with those entries.</summary>
    public static Dictionary<Guid, List<Guid>> ItemReferences(IEnumerable<CampaignEntry> entries)
    {
        var items = new Dictionary<Guid, List<Guid>>();
        foreach (var entry in entries.Where(e => e.Kind == CampaignEntry.MagicItem))
        {
            var data = Parse(entry.Data);
            foreach (var name in new[] { "elementId", "baseElementId" })
            {
                if (data.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id))
                {
                    if (!items.TryGetValue(id, out var list))
                    {
                        items[id] = list = [];
                    }
                    if (!list.Contains(entry.Id))
                    {
                        list.Add(entry.Id);
                    }
                }
            }
        }
        return items;
    }

    /// <summary>"curse-of-strahd" for the archive's file name.</summary>
    public static string Slug(string name)
    {
        var slug = new string(name.ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-').ToArray());
        while (slug.Contains("--", StringComparison.Ordinal))
        {
            slug = slug.Replace("--", "-", StringComparison.Ordinal);
        }
        slug = slug.Trim('-');
        return slug.Length == 0 ? "campaign" : slug[..Math.Min(slug.Length, 60)];
    }

    private static JsonElement Parse(string? json)
    {
        try
        {
            using var parsed = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            return parsed.RootElement.Clone();
        }
        catch (JsonException)
        {
            using var empty = JsonDocument.Parse("{}");
            return empty.RootElement.Clone();
        }
    }
}
