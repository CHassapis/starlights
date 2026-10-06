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
    /// <param name="reader">The player reading (verified: their player is not locked, or they hold its token), for their own notes.</param>
    public static List<CampaignEntryModel> Entries(IEnumerable<CampaignEntry> entries, bool dm, string? reader = null) =>
        entries
            .Where(e => e.Kind == CampaignEntry.Note ? CanReadNote(e, dm, reader) : dm || e.Visible || e.Kind == CampaignEntry.Ledger)
            .Select(e => Entry(e, dm))
            .ToList();

    /// <summary>A note's scope and author from its details.</summary>
    public static (string Scope, string Author) NoteOf(CampaignEntry e)
    {
        try
        {
            using var data = JsonDocument.Parse(string.IsNullOrWhiteSpace(e.Data) ? "{}" : e.Data);
            string Text(string name) => data.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            return (Text("scope"), Text("author"));
        }
        catch (JsonException)
        {
            return ("private", "");
        }
    }

    /// <summary>Party notes: everyone in the campaign; the DM's notebook: the DM; a private note: its author only (not the DM).</summary>
    public static bool CanReadNote(CampaignEntry e, bool dm, string? reader)
    {
        var (scope, author) = NoteOf(e);
        return scope switch
        {
            "party" => true,
            "dm" => dm,
            _ => !string.IsNullOrWhiteSpace(reader) && string.Equals(author.Trim(), reader.Trim(), StringComparison.OrdinalIgnoreCase),
        };
    }

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

/// <summary>A party member carrying one of the campaign's magic items (how many of it).</summary>
public sealed record ItemHolder(Guid EntryId, Guid CharacterId, string Name, int Quantity);

/// <summary>
/// Who has the campaign's magic items: each party member's equipment is searched for the item of the content a
/// magic item entry names (data.elementId), or for the campaign's own item the DM gave (a homebrew copy under the
/// entry's title, with the campaign as its source). Always up to date after gifts, trades and players' own changes.
/// </summary>
public static class CampaignItemHolders
{
    public static List<ItemHolder> Find(IEnumerable<CampaignEntry> entries, string campaignName, IEnumerable<(Guid Id, string Name, Domain.Characters.CharacterInventory Inventory)> party)
    {
        var members = party.ToList();
        var holders = new List<ItemHolder>();
        foreach (var entry in entries.Where(e => e.Kind == CampaignEntry.MagicItem))
        {
            Guid? elementId = null;
            try
            {
                using var data = JsonDocument.Parse(string.IsNullOrWhiteSpace(entry.Data) ? "{}" : entry.Data);
                if (data.RootElement.TryGetProperty("elementId", out var v) && v.ValueKind == JsonValueKind.String && Guid.TryParse(v.GetString(), out var id))
                {
                    elementId = id;
                }
            }
            catch (JsonException)
            {
            }
            foreach (var (characterId, name, inventory) in members)
            {
                var count = inventory.Items
                    .Where(i => elementId is { } e
                        ? i.ElementId == e
                        : i.ElementId is null && i.Custom?.Source == campaignName && string.Equals(i.Name, entry.Title, StringComparison.OrdinalIgnoreCase))
                    .Sum(i => Math.Max(1, i.Quantity));
                if (count > 0)
                {
                    holders.Add(new ItemHolder(entry.Id, characterId, name, count));
                }
            }
        }
        return holders;
    }
}
