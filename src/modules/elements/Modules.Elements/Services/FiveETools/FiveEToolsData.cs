using System.Collections.Concurrent;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Services.FiveETools;

/// <summary>
/// Location of the 5etools "data" folder (config <c>FiveETools:Path</c>, default /data/5etools).
/// </summary>
public sealed record FiveEToolsOptions(string DataPath);

/// <summary>
/// Reads the 5etools data release for what Aurora Legacy lacks: deities it has no entry for (generated as
/// Aurora elements, so the builder offers them like any other), and the organizations of the realms. Files are
/// read again when they change on disk, so a newer release is picked up without a restart.
/// </summary>
internal sealed class FiveEToolsData : IFiveEToolsLore
{
    /// <summary>Folder name the generated elements are filed under (their "file" and their sources group).</summary>
    public const string Prefix = "5etools/";

    private readonly FiveEToolsOptions _options;
    private readonly ILogger<FiveEToolsData> _logger;
    private readonly ConcurrentDictionary<string, (DateTime Modified, object Value)> _cache = new();

    public FiveEToolsData(FiveEToolsOptions options, ILogger<FiveEToolsData> logger)
    {
        _options = options;
        _logger = logger;
    }

    public bool Available => File.Exists(Path.Combine(_options.DataPath, "deities.json"));

    /// <summary>
    /// The deities Aurora has no entry of the same name for, as an Aurora element file: the Greek, Norse,
    /// Egyptian and Celtic pantheons, most elven and dwarven gods, the 2024 Greyhawk and 2025 Faerûn additions.
    /// </summary>
    public XDocument? DeitiesAsAurora(IReadOnlySet<string> auroraDeityNames, IReadOnlyCollection<string> auroraSources)
    {
        using var document = Read("deities.json");
        if (document is null)
        {
            return null;
        }

        var books = SourceNames();
        var byNormalizedName = auroraSources
            .GroupBy(Normalize)
            .ToDictionary(g => g.Key, g => g.First());

        // a 5etools book that Aurora also has keeps Aurora's spelling of the name, so the books merge
        string SourceName(string abbreviation)
        {
            var name = books.GetValueOrDefault(abbreviation, abbreviation);
            return byNormalizedName.GetValueOrDefault(Normalize(name), name);
        }

        var root = new XElement("elements");
        var seen = new HashSet<string>(auroraDeityNames, StringComparer.OrdinalIgnoreCase);
        var deities = document.RootElement.GetProperty("deity").EnumerateArray()
            // the newest printing of a god, when it was reprinted
            .OrderBy(d => d.TryGetProperty("reprintedAs", out _) ? 1 : 0);

        foreach (var deity in deities)
        {
            var name = FiveEToolsRenderer.Text(deity, "name");
            var source = FiveEToolsRenderer.Text(deity, "source");
            if (name is null || source is null || !seen.Add(name))
            {
                continue;
            }

            var pantheon = FiveEToolsRenderer.Text(deity, "pantheon");
            var title = FiveEToolsRenderer.Text(deity, "title");
            var description = new XElement("description");
            if (title is not null)
            {
                description.Add(new XElement("p", new XAttribute("class", "flavor"), FiveEToolsRenderer.Inline(title)));
            }
            if (deity.TryGetProperty("entries", out var entries))
            {
                description.Add(FiveEToolsRenderer.Entries(entries));
            }

            var setters = new XElement("setters");
            void Set(string key, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    setters.Add(new XElement("set", new XAttribute("name", key), value));
                }
            }
            Set("setting", pantheon);
            Set("alignment", deity.TryGetProperty("alignment", out var alignment) ? string.Concat(alignment.EnumerateArray().Select(a => a.GetString())) : null);
            Set("domains", deity.TryGetProperty("domains", out var domains) ? string.Join(", ", domains.EnumerateArray().Select(d => d.GetString())) : null);
            Set("symbol", FiveEToolsRenderer.Text(deity, "symbol") is { } symbol ? FiveEToolsRenderer.PlainText(symbol) : null);
            Set("province", FiveEToolsRenderer.Text(deity, "province") is { } province ? FiveEToolsRenderer.PlainText(province) : null);

            var id = $"ID_5ETOOLS_DEITY_{Slug(source)}_{Slug(pantheon ?? "")}_{Slug(name)}";
            root.Add(new XElement("element",
                new XAttribute("name", name),
                new XAttribute("type", "Deity"),
                new XAttribute("source", SourceName(source)),
                new XAttribute("id", id),
                description,
                setters,
                new XElement("sheet", new XElement("description", title is null ? name : FiveEToolsRenderer.PlainText(title)))));
        }

        _logger.LogInformation("generated {Count} deities from 5etools that Aurora lacks", root.Elements().Count());
        return new XDocument(root);
    }

    public IReadOnlyList<LoreEntry> GetOrganizations() => Cached("book/book-frhof.json", () =>
    {
        using var document = Read("book/book-frhof.json");
        if (document is null)
        {
            return new List<LoreEntry>();
        }

        const string source = "Forgotten Realms: Heroes of Faerûn";
        var chapter = document.RootElement.GetProperty("data").EnumerateArray()
            .FirstOrDefault(c => FiveEToolsRenderer.Text(c, "name")?.Contains("Factions", StringComparison.OrdinalIgnoreCase) == true);
        if (chapter.ValueKind != JsonValueKind.Object)
        {
            return new List<LoreEntry>();
        }

        // the chapter's own introductions are not organizations; the two groups hold one organization each
        string[] notOrganizations = ["Faction Descriptions", "Special Facilities", "Faction Relationships"];
        string[] groups = ["Criminal Syndicates", "Other Organizations"];

        var organizations = new List<LoreEntry>();
        foreach (var section in chapter.GetProperty("entries").EnumerateArray())
        {
            var name = FiveEToolsRenderer.Text(section, "name");
            if (name is null || notOrganizations.Contains(name))
            {
                continue;
            }
            if (groups.Contains(name))
            {
                foreach (var member in section.GetProperty("entries").EnumerateArray())
                {
                    if (FiveEToolsRenderer.Text(member, "name") is { } memberName)
                    {
                        organizations.Add(new LoreEntry(memberName, source, name, FiveEToolsRenderer.ToHtml(FiveEToolsRenderer.Entries(member.GetProperty("entries")))));
                    }
                }
                continue;
            }
            organizations.Add(new LoreEntry(name, source, "Factions", FiveEToolsRenderer.ToHtml(FiveEToolsRenderer.Entries(section.GetProperty("entries")))));
        }
        return organizations;
    });

    // 5etools abbreviations (PHB, MTF, …) to the books' full names
    private Dictionary<string, string> SourceNames() => Cached("books.json", () =>
    {
        var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (file, key) in new[] { ("books.json", "book"), ("adventures.json", "adventure") })
        {
            using var document = Read(file);
            if (document is null)
            {
                continue;
            }
            foreach (var book in document.RootElement.GetProperty(key).EnumerateArray())
            {
                if (FiveEToolsRenderer.Text(book, "id") is { } id && FiveEToolsRenderer.Text(book, "name") is { } name)
                {
                    names.TryAdd(id, name);
                }
            }
        }
        return names;
    });

    private T Cached<T>(string file, Func<T> load) where T : class
    {
        var path = Path.Combine(_options.DataPath, file);
        var modified = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;
        if (_cache.TryGetValue(file, out var entry) && entry.Modified == modified)
        {
            return (T)entry.Value;
        }
        var value = load();
        _cache[file] = (modified, value);
        return value;
    }

    private JsonDocument? Read(string file)
    {
        var path = Path.Combine(_options.DataPath, file);
        if (!File.Exists(path))
        {
            return null;
        }
        using var stream = File.OpenRead(path);
        return JsonDocument.Parse(stream);
    }

    // "Player's Handbook (2014)" and Aurora's "Player’s Handbook" are the same book
    private static string Normalize(string name) =>
        name.Replace('’', '\'').Replace(" (2014)", "", StringComparison.Ordinal).Trim().ToLowerInvariant();

    private static string Slug(string text) =>
        new string(text.ToUpperInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : '_').ToArray()).Trim('_');
}
