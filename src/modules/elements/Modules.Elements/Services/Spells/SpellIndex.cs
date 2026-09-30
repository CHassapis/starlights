using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Services.Items;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Services.Spells;

/// <summary>
/// The spells of the content, read from their Aurora XML once per content version and kept in memory.
/// </summary>
internal sealed class SpellIndex : ISpellIndex
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<SpellIndex> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private SpellIndexSnapshot? _snapshot;

    public SpellIndex(IServiceScopeFactory scopes, ILogger<SpellIndex> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    public async Task<SpellIndexSnapshot> GetAsync(CancellationToken cancellationToken = default)
    {
        var version = ElementsContentVersion.Current;
        if (_snapshot?.Version == version)
        {
            return _snapshot;
        }

        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_snapshot?.Version == version)
            {
                return _snapshot;
            }

            using var scope = _scopes.CreateScope();
            var repository = scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<IElementsRepository>();
            var spells = new List<SpellInfo>();
            foreach (var element in await repository.GetAuroraElementsAsync(["Spell"]))
            {
                try
                {
                    spells.Add(Read(element));
                }
                catch (XmlException ex)
                {
                    _logger.LogWarning("spell '{Name}' could not be read: {Error}", element.Name, ex.Message);
                }
            }

            _snapshot = new SpellIndexSnapshot(version, spells.OrderBy(s => s.Level).ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList());
            return _snapshot;
        }
        finally
        {
            _lock.Release();
        }
    }

    public static SpellInfo Read(AuroraElementXml element)
    {
        var xml = XElement.Parse(element.RawXml);
        var setters = xml.Element("setters")?.Elements("set").Where(s => s.Attribute("name") is not null)
            .GroupBy(s => (string)s.Attribute("name")!)
            .ToDictionary(g => g.Key, g => g.First().Value.Trim()) ?? [];
        string? Set(string key) => setters.GetValueOrDefault(key) is { Length: > 0 } v ? v : null;
        bool Flag(string key) => string.Equals(Set(key), "true", StringComparison.OrdinalIgnoreCase);

        var components = new List<string>();
        if (Flag("hasVerbalComponent")) components.Add("V");
        if (Flag("hasSomaticComponent")) components.Add("S");
        if (Flag("hasMaterialComponent")) components.Add(Set("materialComponent") is { } material ? $"M ({material})" : "M");

        return new SpellInfo
        {
            Id = element.Id,
            Name = element.Name,
            AuroraId = element.AuroraId,
            Source = element.Source,
            Level = int.TryParse(Set("level"), out var level) ? level : 0,
            School = Set("school"),
            Lists = (xml.Element("supports")?.Value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            Ritual = Flag("isRitual"),
            Concentration = Flag("isConcentration"),
            CastingTime = Set("time"),
            Range = Set("range"),
            Duration = Set("duration"),
            Components = string.Join(", ", components),
        };
    }

    public async Task<IReadOnlyList<SpellcastingDefinition>> GetSpellcastingAsync(IReadOnlyCollection<Guid> elementIds, CancellationToken cancellationToken = default)
    {
        using var scope = _scopes.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<IElementsRepository>();
        var xml = await repository.GetAuroraXmlByIdsAsync(elementIds);
        return xml.Select(pair => ReadSpellcasting(pair.Key, pair.Value)).OfType<SpellcastingDefinition>().ToList();
    }

    public async Task<IReadOnlyDictionary<Guid, ElementMagic>> GetElementMagicAsync(IReadOnlyCollection<Guid> elementIds, CancellationToken cancellationToken = default)
    {
        using var scope = _scopes.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<IElementsRepository>();
        var xml = await repository.GetAuroraXmlByIdsAsync(elementIds);
        var magic = new Dictionary<Guid, ElementMagic>();
        foreach (var (id, raw) in xml)
        {
            if (ReadMagic(id, raw) is { } m)
            {
                magic[id] = m;
            }
        }
        return magic;
    }

    /// <summary>The magic in one element's XML; null when it has none (no spellcasting, spell grants or selects).</summary>
    public static ElementMagic? ReadMagic(Guid elementId, string rawXml)
    {
        XElement xml;
        try
        {
            xml = XElement.Parse(rawXml);
        }
        catch (XmlException)
        {
            return null;
        }

        static bool True(XAttribute? a) => string.Equals((string?)a, "true", StringComparison.OrdinalIgnoreCase);
        static int? Int(XAttribute? a) => int.TryParse((string?)a, out var n) ? n : null;
        static bool IsSpell(XElement e) => string.Equals((string?)e.Attribute("type"), "Spell", StringComparison.OrdinalIgnoreCase);

        var rules = xml.Element("rules")?.Elements().ToList() ?? [];
        var grants = rules.Where(r => r.Name == "grant" && IsSpell(r) && r.Attribute("id") is not null)
            .Select(r => new SpellGrant((string)r.Attribute("id")!, (string?)r.Attribute("spellcasting"), True(r.Attribute("prepared")), Int(r.Attribute("level"))))
            .ToList();
        var selects = rules.Where(r => r.Name == "select" && IsSpell(r) && r.Attribute("name") is not null)
            .Select(r => new SpellSelect((string)r.Attribute("name")!, (string?)r.Attribute("spellcasting"), True(r.Attribute("prepared")), Int(r.Attribute("level")), Int(r.Attribute("number")) ?? 1))
            .ToList();
        var stats = rules.Where(r => r.Name == "stat" && ((string?)r.Attribute("name"))?.Contains("spellcasting", StringComparison.OrdinalIgnoreCase) == true)
            .Select(r => new SpellcastingStat((string)r.Attribute("name")!, (string?)r.Attribute("value") ?? string.Empty, Int(r.Attribute("level"))))
            .ToList();
        // FULL, HALF, THIRD and SOLO are not elements (Aurora works them out itself), so read the grant, not a registration
        var multiclass = rules.Where(r => r.Name == "grant")
            .Select(r => (string?)r.Attribute("id"))
            .Select(id => id switch
            {
                "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL" => MulticlassSlots.Full,
                "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF" => MulticlassSlots.Half,
                "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF_UP" => MulticlassSlots.HalfUp,
                "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD" => MulticlassSlots.Third,
                "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO" => MulticlassSlots.Solo,
                _ => (MulticlassSlots?)null,
            })
            .FirstOrDefault(k => k is not null);
        var spellcasting = ReadSpellcasting(elementId, xml);

        if (spellcasting is null && grants.Count == 0 && selects.Count == 0 && stats.Count == 0)
        {
            return null;
        }
        return new ElementMagic(elementId, (string?)xml.Attribute("name") ?? string.Empty, (string?)xml.Attribute("source"), spellcasting, multiclass, grants, selects, stats);
    }

    public static SpellcastingDefinition? ReadSpellcasting(Guid elementId, string rawXml)
    {
        try
        {
            return ReadSpellcasting(elementId, XElement.Parse(rawXml));
        }
        catch (XmlException)
        {
            return null;
        }
    }

    private static SpellcastingDefinition? ReadSpellcasting(Guid elementId, XElement element)
    {
        var spellcasting = element.Element("spellcasting");
        if (spellcasting?.Attribute("name") is not { } name)
        {
            return null;
        }

        static bool True(XAttribute? attribute) => string.Equals((string?)attribute, "true", StringComparison.OrdinalIgnoreCase);
        static IEnumerable<string> Terms(string text) => text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var lists = spellcasting.Elements("list").ToList();
        return new SpellcastingDefinition(
            elementId,
            name.Value,
            (string?)spellcasting.Attribute("ability"),
            True(spellcasting.Attribute("prepare")),
            lists.Any(l => True(l.Attribute("known"))),
            True(spellcasting.Attribute("allowReplace")),
            True(spellcasting.Attribute("extend")),
            lists.SelectMany(l => Terms(l.Value)).Distinct().ToList(),
            spellcasting.Elements("extend").SelectMany(e => Terms(e.Value)).Distinct().ToList());
    }

    public async Task<string?> GetSelectSpellcastingAsync(Guid elementId, string selectName, CancellationToken cancellationToken = default)
    {
        using var scope = _scopes.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<IElementsRepository>();
        var xml = await repository.GetAuroraXmlByIdsAsync([elementId]);
        if (!xml.TryGetValue(elementId, out var raw))
        {
            return null;
        }
        try
        {
            return XElement.Parse(raw).Element("rules")?.Elements("select")
                .Where(s => string.Equals((string?)s.Attribute("name"), selectName, StringComparison.Ordinal))
                .Select(s => (string?)s.Attribute("spellcasting"))
                .FirstOrDefault(s => !string.IsNullOrEmpty(s));
        }
        catch (XmlException)
        {
            return null;
        }
    }

    public async Task<List<SpellInfo>> GetSpellOptionsAsync(string supports, IReadOnlyCollection<string> lists, IReadOnlyCollection<int> slotLevels, CancellationToken cancellationToken = default)
    {
        var snapshot = await GetAsync(cancellationToken);
        var matches = SupportsExpression.Compile(SupportsExpression.FillSpellPlaceholders(supports, lists, slotLevels), numbersAreTerms: true);
        return snapshot.Spells
            .Where(s => matches([.. s.Lists, s.Level.ToString(System.Globalization.CultureInfo.InvariantCulture)], s.AuroraId))
            .ToList();
    }
}
