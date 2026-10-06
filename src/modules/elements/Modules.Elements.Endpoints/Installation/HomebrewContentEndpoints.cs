using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using FastEndpoints;
using Microsoft.Extensions.Configuration;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Endpoints.Installation;

/// <summary>
/// Homebrew made on the Homebrew page instead of uploaded: magic items (written as Aurora elements into
/// starlights-items.xml in the homebrew folder and imported, so they work in the builder like any book item) and
/// monsters (kept as JSON in starlights-monsters.json, for campaigns' encounters). Reading is open; writing needs
/// the admin key or password, like all content changes.
/// </summary>
internal static partial class HomebrewContent
{
    public const string ItemsFile = "starlights-items.xml";
    public const string MonstersFile = "starlights-monsters.json";
    public static readonly SemaphoreSlim Gate = new(1, 1);

    public static readonly Dictionary<string, string> KindCategory = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Wondrous Item"] = "Wondrous Items", ["Weapon"] = "Magic Weapons", ["Armor"] = "Magic Armor", ["Ring"] = "Rings",
        ["Potion"] = "Potions", ["Scroll"] = "Scrolls", ["Staff"] = "Staffs", ["Wand"] = "Wands", ["Rod"] = "Rods",
    };

    public static readonly string[] Rarities = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"];

    [GeneratedRegex("[^A-Z0-9]+")]
    private static partial Regex NotIdChar();

    public static string IdFor(string prefix, string name) => prefix + NotIdChar().Replace(name.ToUpperInvariant(), "_").Trim('_');

    public static string ItemsPath(IConfiguration config) => Path.Combine(HomebrewFiles.Folder(config), ItemsFile);

    public static string MonstersPath(IConfiguration config) => Path.Combine(HomebrewFiles.Folder(config), MonstersFile);

    public static XDocument LoadItems(IConfiguration config) =>
        File.Exists(ItemsPath(config)) ? XDocument.Load(ItemsPath(config)) : new XDocument(new XElement("elements"));

    public static JsonArray LoadMonsters(IConfiguration config)
    {
        try
        {
            return File.Exists(MonstersPath(config)) ? JsonNode.Parse(File.ReadAllText(MonstersPath(config))) as JsonArray ?? [] : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

/// <summary>A homebrew magic item as the form edits it.</summary>
public sealed record HomebrewItemModel
{
    public string? Id { get; init; }
    public string Name { get; init; } = string.Empty;
    /// <summary>The book it shows under ("Homebrew", "Curse of Strahd (homebrew)").</summary>
    public string? Source { get; init; }
    /// <summary>Wondrous Item, Weapon, Armor, Ring, Potion, Scroll, Staff, Wand or Rod.</summary>
    public string Kind { get; init; } = "Wondrous Item";
    public string Rarity { get; init; } = "Uncommon";
    public bool Attunement { get; init; }
    public string? AttunementBy { get; init; }
    public int? Charges { get; init; }
    /// <summary>The weapon or armor it is made from ("Rapier", "Chain Shirt"), for a magic weapon or armor.</summary>
    public string? Base { get; init; }
    /// <summary>A magic weapon's own damage dice ("1d6"), instead of its base weapon's.</summary>
    public string? Damage { get; init; }
    public decimal? Weight { get; init; }
    public int? Cost { get; init; }
    /// <summary>What it does: plain text, paragraphs separated by blank lines.</summary>
    public string Description { get; init; } = string.Empty;
}

public sealed record HomebrewItemsResponse(List<HomebrewItemModel> Items);

internal static class HomebrewItemXml
{
    public static XElement ToXml(HomebrewItemModel m, string id)
    {
        var kind = HomebrewContent.KindCategory.ContainsKey(m.Kind) ? m.Kind : "Wondrous Item";
        var setters = new XElement("setters",
            new XElement("set", new XAttribute("name", "category"), HomebrewContent.KindCategory[kind]),
            kind is "Weapon" or "Armor" && !string.IsNullOrWhiteSpace(m.Base)
                ? new XElement("set", new XAttribute("name", "type"), new XAttribute("addition", m.Base!.Trim()), kind)
                : new XElement("set", new XAttribute("name", "type"), kind),
            new XElement("set", new XAttribute("name", "rarity"), m.Rarity));
        if (kind == "Weapon" && !string.IsNullOrWhiteSpace(m.Base)) setters.Add(new XElement("set", new XAttribute("name", "weapon"), m.Base.Trim()));
        if (kind == "Weapon" && !string.IsNullOrWhiteSpace(m.Damage)) setters.Add(new XElement("set", new XAttribute("name", "damage"), m.Damage.Trim()));
        if (kind == "Armor" && !string.IsNullOrWhiteSpace(m.Base)) setters.Add(new XElement("set", new XAttribute("name", "armor"), m.Base.Trim()));
        if (m.Attunement)
        {
            var attunement = new XElement("set", new XAttribute("name", "attunement"), "true");
            if (!string.IsNullOrWhiteSpace(m.AttunementBy)) attunement.Add(new XAttribute("addition", m.AttunementBy.Trim()));
            setters.Add(attunement);
        }
        if (m.Charges is > 0) setters.Add(new XElement("set", new XAttribute("name", "charges"), m.Charges.Value));
        if (m.Weight is > 0)
        {
            var lb = m.Weight.Value.ToString("0.##", CultureInfo.InvariantCulture);
            setters.Add(new XElement("set", new XAttribute("name", "weight"), new XAttribute("lb", lb), $"{lb} lb."));
        }
        setters.Add(new XElement("set", new XAttribute("name", "cost"), new XAttribute("currency", "gp"), m.Cost ?? 0));
        var paragraphs = m.Description.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new XElement("element",
            new XAttribute("name", m.Name.Trim()),
            new XAttribute("type", "Magic Item"),
            new XAttribute("source", string.IsNullOrWhiteSpace(m.Source) ? "Homebrew" : m.Source.Trim()),
            new XAttribute("id", id),
            new XElement("description", paragraphs.Length == 0 ? [new XElement("p", m.Name.Trim())] : paragraphs.Select(p => new XElement("p", p))),
            setters);
    }

    public static HomebrewItemModel FromXml(XElement e)
    {
        var setters = e.Element("setters")?.Elements("set").ToList() ?? [];
        XElement? Set(string name) => setters.FirstOrDefault(s => (string?)s.Attribute("name") == name);
        var type = Set("type");
        return new HomebrewItemModel
        {
            Id = (string?)e.Attribute("id"),
            Name = (string?)e.Attribute("name") ?? string.Empty,
            Source = (string?)e.Attribute("source"),
            Kind = type?.Value.Trim() is { Length: > 0 } t ? t : "Wondrous Item",
            Rarity = Set("rarity")?.Value.Trim() ?? "Uncommon",
            Attunement = string.Equals(Set("attunement")?.Value.Trim(), "true", StringComparison.OrdinalIgnoreCase),
            AttunementBy = (string?)Set("attunement")?.Attribute("addition"),
            Charges = int.TryParse(Set("charges")?.Value, out var c) ? c : null,
            Base = Set("weapon")?.Value.Trim() ?? Set("armor")?.Value.Trim() ?? (string?)type?.Attribute("addition"),
            Damage = Set("damage")?.Value.Trim(),
            Weight = decimal.TryParse((string?)Set("weight")?.Attribute("lb"), NumberStyles.Number, CultureInfo.InvariantCulture, out var w) ? w : null,
            Cost = int.TryParse(Set("cost")?.Value, out var cost) ? cost : null,
            Description = string.Join("\n\n", e.Element("description")?.Elements("p").Select(p => p.Value.Trim()) ?? []),
        };
    }
}

public sealed class GetHomebrewItemsEndpoint : EndpointWithoutRequest<HomebrewItemsResponse>
{
    public override void Configure()
    {
        Get("/homebrew/items");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var items = HomebrewContent.LoadItems(Config).Root!.Elements("element").Select(HomebrewItemXml.FromXml).OrderBy(i => i.Name).ToList();
        await Send.OkAsync(new HomebrewItemsResponse(items), ct);
    }
}

/// <summary>Adds a homebrew magic item, or changes the one with the same id, and imports it.</summary>
public sealed class SaveHomebrewItemEndpoint : Endpoint<HomebrewItemModel, HomebrewItemModel>
{
    private readonly IAuroraImporter _importer;

    public SaveHomebrewItemEndpoint(IAuroraImporter importer) => _importer = importer;

    public override void Configure()
    {
        Put("/homebrew/items");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(HomebrewItemModel req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Trim().Length > 100 || req.Description.Length > 20_000 || (req.Source?.Length ?? 0) > 100
            || !HomebrewContent.Rarities.Contains(req.Rarity) || req.Charges is < 0 or > 100 || req.Weight is < 0 or > 10_000 || req.Cost is < 0
            || (!string.IsNullOrWhiteSpace(req.Damage) && !Regex.IsMatch(req.Damage.Trim(), @"^\d{1,2}d\d{1,3}$")))
        {
            AddError("A homebrew item needs a name (100 characters at most), a rarity, and sensible numbers (damage like 1d6).");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            var document = HomebrewContent.LoadItems(Config);
            var id = string.IsNullOrWhiteSpace(req.Id) ? HomebrewContent.IdFor("ID_STARLIGHTS_HOMEBREW_ITEM_", req.Name) : req.Id!;
            var existing = document.Root!.Elements("element").FirstOrDefault(e => (string?)e.Attribute("id") == id);
            var xml = HomebrewItemXml.ToXml(req, id);
            if (existing is null)
            {
                document.Root.Add(xml);
            }
            else
            {
                existing.ReplaceWith(xml);
            }
            Directory.CreateDirectory(HomebrewFiles.Folder(Config));
            document.Save(HomebrewContent.ItemsPath(Config));
            await _importer.ImportAsync(AuroraImporterIndex.Homebrew, replace: false, update: true, ct);
            await Send.OkAsync(HomebrewItemXml.FromXml(xml), ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}

public sealed class DeleteHomebrewItemEndpoint : EndpointWithoutRequest
{
    private readonly IAuroraImporter _importer;

    public DeleteHomebrewItemEndpoint(IAuroraImporter importer) => _importer = importer;

    public override void Configure()
    {
        Delete("/homebrew/items/{id}");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<string>("id");
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            var document = HomebrewContent.LoadItems(Config);
            var existing = document.Root!.Elements("element").FirstOrDefault(e => (string?)e.Attribute("id") == id);
            if (existing is null)
            {
                await Send.NotFoundAsync(ct);
                return;
            }
            existing.Remove();
            document.Save(HomebrewContent.ItemsPath(Config));
            // the file's elements go, then the ones left come back
            await _importer.RemoveAsync("homebrew/" + HomebrewContent.ItemsFile, ct);
            await _importer.ImportAsync(AuroraImporterIndex.Homebrew, replace: false, update: true, ct);
            await Send.NoContentAsync(ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}

public sealed record HomebrewMonstersResponse(JsonArray Monsters);

public sealed class GetHomebrewMonstersEndpoint : EndpointWithoutRequest<HomebrewMonstersResponse>
{
    public override void Configure()
    {
        Get("/homebrew/monsters");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct) => await Send.OkAsync(new HomebrewMonstersResponse(HomebrewContent.LoadMonsters(Config)), ct);
}

/// <summary>Adds a homebrew monster (a stat block as JSON), or changes the one with the same id.</summary>
public sealed class SaveHomebrewMonsterEndpoint : EndpointWithoutRequest<JsonObject>
{
    public override void Configure()
    {
        Put("/homebrew/monsters");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        // a stat block is free-form JSON, so the body is read as it is
        JsonObject? monster;
        try
        {
            monster = await JsonNode.ParseAsync(HttpContext.Request.Body, cancellationToken: ct) as JsonObject;
        }
        catch (JsonException)
        {
            monster = null;
        }
        var name = monster?["name"]?.GetValueKind() == JsonValueKind.String ? monster["name"]!.GetValue<string>().Trim() : string.Empty;
        if (monster is null || name.Length is 0 or > 100 || monster.ToJsonString().Length > 50_000)
        {
            AddError("A homebrew monster needs a name (100 characters at most) and must be under 50,000 characters.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            var monsters = HomebrewContent.LoadMonsters(Config);
            var id = monster["id"]?.GetValueKind() == JsonValueKind.String && monster["id"]!.GetValue<string>().Length > 0
                ? monster["id"]!.GetValue<string>()
                : HomebrewContent.IdFor("hb-", name).ToLowerInvariant();
            monster["id"] = id;
            monster["name"] = name;
            var at = monsters.OfType<JsonObject>().ToList().FindIndex(m => m["id"]?.ToString() == id);
            if (at < 0 && monsters.Count >= 500)
            {
                AddError("At most 500 homebrew monsters.");
                await Send.ErrorsAsync(cancellation: ct);
                return;
            }
            if (at < 0) monsters.Add(monster);
            else monsters[at] = monster;
            Directory.CreateDirectory(HomebrewFiles.Folder(Config));
            await File.WriteAllTextAsync(HomebrewContent.MonstersPath(Config), monsters.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), ct);
            await Send.OkAsync((JsonObject)monster.DeepClone(), ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}

public sealed class DeleteHomebrewMonsterEndpoint : EndpointWithoutRequest
{
    public override void Configure()
    {
        Delete("/homebrew/monsters/{id}");
        AllowAnonymous();
        Group<ElementsGroup>();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<string>("id");
        await HomebrewContent.Gate.WaitAsync(ct);
        try
        {
            var monsters = HomebrewContent.LoadMonsters(Config);
            var found = monsters.OfType<JsonObject>().FirstOrDefault(m => m["id"]?.ToString() == id);
            if (found is null)
            {
                await Send.NotFoundAsync(ct);
                return;
            }
            monsters.Remove(found);
            await File.WriteAllTextAsync(HomebrewContent.MonstersPath(Config), monsters.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), ct);
            await Send.NoContentAsync(ct);
        }
        finally
        {
            HomebrewContent.Gate.Release();
        }
    }
}
