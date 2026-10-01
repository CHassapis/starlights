using System.Text.Json;
using Starlights.Modules.Characters.Domain.Campaigns;

namespace Starlights.Modules.Characters.Services.Campaigns;

/// <summary>A campaign entry as the app receives it; <see cref="DmNotes"/> is null for players.</summary>
public sealed record CampaignEntryModel(
    Guid Id,
    string Kind,
    string Title,
    int? Number,
    string? OccurredOn,
    bool Visible,
    string Body,
    string? DmNotes,
    string? ImageUrl,
    JsonElement Data,
    int Sort,
    DateTimeOffset UpdatedAt);

/// <summary>
/// What of a campaign the reader may see. Every response with campaign entries goes through here: for players the
/// entries the DM has not revealed are left out (ledger lines always stay, so the party fund adds up the same for
/// everyone) and no entry carries the DM's notes.
/// </summary>
public static class CampaignView
{
    public static List<CampaignEntryModel> Entries(IEnumerable<CampaignEntry> entries, bool dm) =>
        entries.Where(e => dm || e.Visible || e.Kind == CampaignEntry.Ledger).Select(e => Entry(e, dm)).ToList();

    public static CampaignEntryModel Entry(CampaignEntry e, bool dm)
    {
        JsonElement data;
        try
        {
            using var parsed = JsonDocument.Parse(string.IsNullOrWhiteSpace(e.Data) ? "{}" : e.Data);
            data = parsed.RootElement.Clone();
        }
        catch (JsonException)
        {
            using var empty = JsonDocument.Parse("{}");
            data = empty.RootElement.Clone();
        }
        return new CampaignEntryModel(e.Id, e.Kind, e.Title, e.Number, e.OccurredOn, e.Visible || e.Kind == CampaignEntry.Ledger, e.Body, dm ? e.DmNotes : null, e.ImageUrl, data, e.Sort, e.UpdatedAt);
    }
}
