using System.Text.Json;
using Starlights.Platform.Domain;

namespace Starlights.Modules.Characters.Domain.Campaigns;

/// <summary>
/// A campaign the DM runs: its name, a description and cover picture, and the party (Starlights characters).
/// Everything that happens in it is a <see cref="CampaignEntry"/>.
/// </summary>
public sealed class Campaign : EntityBase<Guid>
{
    private Campaign(Guid id, string name)
        : base(id)
    {
        Name = name;
    }

    public string Name { get; private set; }

    public string Description { get; private set; } = string.Empty;

    public string? CoverUrl { get; private set; }

    private List<Guid> _party = [];

    /// <summary>The characters in the party, in the order the DM listed them.</summary>
    public IReadOnlyList<Guid> Party => _party.AsReadOnly();

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>
    /// The salted hash of the campaign's password, or null when it is open: with one, only those who give the
    /// password (and the DM) can read the campaign or add a character to it.
    /// </summary>
    public string? PasswordHash { get; private set; }

    public void SetPasswordHash(string? hash)
    {
        PasswordHash = hash;
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>Adds a character to the party (a player joining); false when the party is full.</summary>
    public bool Join(Guid characterId)
    {
        if (_party.Contains(characterId))
        {
            return true;
        }
        if (_party.Count >= 20)
        {
            return false;
        }
        _party.Add(characterId);
        UpdatedAt = DateTimeOffset.UtcNow;
        return true;
    }

    public void Leave(Guid characterId)
    {
        _party.Remove(characterId);
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static Campaign Create(string name)
    {
        var now = DateTimeOffset.UtcNow;
        return new Campaign(Guid.CreateVersion7(), name.Trim()) { CreatedAt = now, UpdatedAt = now };
    }

    public void Update(string name, string description, string? coverUrl, IEnumerable<Guid> party)
    {
        Name = name.Trim();
        Description = description;
        CoverUrl = coverUrl;
        _party = party.Distinct().ToList();
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>What is wrong with these values, or null when they are fine.</summary>
    public static string? Validate(string? name, string? description, string? coverUrl, IReadOnlyCollection<Guid>? party)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200)
        {
            return "A campaign needs a name of at most 200 characters.";
        }
        if ((description?.Length ?? 0) > 20_000 || (coverUrl?.Length ?? 0) > 500)
        {
            return "The description is too long (20,000 characters at most).";
        }
        if ((party?.Count ?? 0) > 20)
        {
            return "At most 20 characters in a party.";
        }
        return null;
    }
}

/// <summary>
/// One record of a campaign: a session, a person, place, faction, item or handout of the codex, a quest, or a line
/// of the ledger. What the players may read is the title, body, picture and <see cref="Data"/>; everything only the
/// DM may read is in <see cref="DmNotes"/>, and an entry the DM has not revealed (<see cref="Visible"/> false) is
/// not shown to players at all, except ledger lines, which everyone sees so the party fund adds up the same.
/// </summary>
public sealed class CampaignEntry : EntityBase<Guid>
{
    public const string Session = "session";
    public const string Ledger = "ledger";

    /// <summary>A magic item of the DM's own, given to characters from the campaign (never offered when building).</summary>
    public const string MagicItem = "magicitem";

    /// <summary>The kinds of entries.</summary>
    public static readonly IReadOnlySet<string> Kinds = new HashSet<string>(["session", "npc", "encounter", "place", "faction", "item", "handout", "quest", "ledger", "map", MagicItem]);

    private CampaignEntry(Guid id, Guid campaignId, string kind)
        : base(id)
    {
        CampaignId = campaignId;
        Kind = kind;
    }

    public Guid CampaignId { get; private set; }

    public string Kind { get; private set; }

    public string Title { get; private set; } = string.Empty;

    /// <summary>A session's number.</summary>
    public int? Number { get; private set; }

    /// <summary>When it happened, as the DM writes it ("2026-09-28", or an in-world date).</summary>
    public string? OccurredOn { get; private set; }

    /// <summary>Whether the players can see it (ledger lines always can).</summary>
    public bool Visible { get; private set; }

    /// <summary>What the players read: a session's recap, a person's description, a handout's text.</summary>
    public string Body { get; private set; } = string.Empty;

    /// <summary>The DM's own notes: secrets, plans, the beat map. Never shown to players.</summary>
    public string DmNotes { get; private set; } = string.Empty;

    public string? ImageUrl { get; private set; }

    /// <summary>
    /// The kind's own details as JSON, all of it readable by players: a quest's or person's status, a session's
    /// level, a ledger line's coins, recipient and items. Never anything secret.
    /// </summary>
    public string Data { get; private set; } = "{}";

    /// <summary>Order within its kind (the DM can move entries); sessions are ordered by number.</summary>
    public int Sort { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static CampaignEntry Create(Guid campaignId, string kind)
    {
        var now = DateTimeOffset.UtcNow;
        return new CampaignEntry(Guid.CreateVersion7(), campaignId, kind) { CreatedAt = now, UpdatedAt = now };
    }

    public void Update(string title, int? number, string? occurredOn, bool visible, string body, string dmNotes, string? imageUrl, string data, int sort)
    {
        Title = title.Trim();
        Number = number;
        OccurredOn = string.IsNullOrWhiteSpace(occurredOn) ? null : occurredOn.Trim();
        Visible = visible;
        Body = body;
        DmNotes = dmNotes;
        ImageUrl = imageUrl;
        Data = data;
        Sort = sort;
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>What is wrong with an entry's values, or null when they are fine.</summary>
    public static string? Validate(string? kind, string? title, int? number, string? occurredOn, string? body, string? dmNotes, string? imageUrl, string? data)
    {
        if (kind is null || !Kinds.Contains(kind))
        {
            return $"The kind must be one of {string.Join(", ", Kinds)}.";
        }
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 200)
        {
            return "An entry needs a title of at most 200 characters.";
        }
        if (number is < 0 or > 100_000 || (occurredOn?.Length ?? 0) > 60 || (imageUrl?.Length ?? 0) > 500)
        {
            return "The number, date or picture is out of range.";
        }
        // a whole session prep document fits (about 100,000 characters)
        if ((body?.Length ?? 0) > 200_000 || (dmNotes?.Length ?? 0) > 200_000)
        {
            return "The text is too long (200,000 characters at most).";
        }
        if ((data?.Length ?? 0) > 20_000)
        {
            return "The details are too long.";
        }
        try
        {
            using var parsed = JsonDocument.Parse(string.IsNullOrWhiteSpace(data) ? "{}" : data);
            if (parsed.RootElement.ValueKind != JsonValueKind.Object)
            {
                return "The details must be a JSON object.";
            }
            if (kind == Ledger && ValidateLedger(parsed.RootElement) is { } problem)
            {
                return problem;
            }
            if (kind == MagicItem && ValidateMagicItem(parsed.RootElement) is { } itemProblem)
            {
                return itemProblem;
            }
        }
        catch (JsonException)
        {
            return "The details are not valid JSON.";
        }
        return null;
    }

    private static readonly string[] Coins = ["cp", "sp", "ep", "gp", "pp"];

    /// <summary>
    /// A magic item's details: rarity, category and attunement as text, weight in pounds, and optionally the item of
    /// the books it is (elementId), which is then given with its rules and the campaign's picture.
    /// </summary>
    private static string? ValidateMagicItem(JsonElement data)
    {
        foreach (var name in new[] { "rarity", "category", "attunement" })
        {
            if (data.TryGetProperty(name, out var value) && (value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 100))
            {
                return "A magic item's rarity, category and attunement are short texts.";
            }
        }
        foreach (var name in new[] { "elementId", "baseElementId" })
        {
            if (data.TryGetProperty(name, out var element) && element.ValueKind != JsonValueKind.Null &&
                (element.ValueKind != JsonValueKind.String || !Guid.TryParse(element.GetString(), out _)))
            {
                return "A magic item's book item is an element id.";
            }
        }
        if (data.TryGetProperty("weight", out var weight) && weight.ValueKind != JsonValueKind.Null &&
            (weight.ValueKind != JsonValueKind.Number || weight.GetDecimal() is < 0 or > 100_000))
        {
            return "A magic item's weight is a number of pounds.";
        }
        return null;
    }

    /// <summary>A ledger line: whole coins per kind (in or out), who it is for ("party", a character, or "other"), items by name.</summary>
    private static string? ValidateLedger(JsonElement data)
    {
        if (data.TryGetProperty("coins", out var coins))
        {
            if (coins.ValueKind != JsonValueKind.Object)
            {
                return "A ledger line's coins are cp, sp, ep, gp and pp.";
            }
            foreach (var coin in coins.EnumerateObject())
            {
                if (!Coins.Contains(coin.Name) || coin.Value.ValueKind != JsonValueKind.Number || !coin.Value.TryGetInt64(out var n) || n is < -1_000_000_000 or > 1_000_000_000)
                {
                    return "A ledger line's coins are whole numbers of cp, sp, ep, gp and pp.";
                }
            }
        }
        if (data.TryGetProperty("to", out var to) && (to.ValueKind != JsonValueKind.String || (to.GetString() is not ("party" or "other") && !Guid.TryParse(to.GetString(), out _))))
        {
            return "A ledger line is for the party, a character, or other.";
        }
        if (data.TryGetProperty("items", out var items) &&
            (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 50 || items.EnumerateArray().Any(i => i.ValueKind != JsonValueKind.String || i.GetString()!.Length > 200)))
        {
            return "A ledger line lists at most 50 items by name.";
        }
        return null;
    }
}
