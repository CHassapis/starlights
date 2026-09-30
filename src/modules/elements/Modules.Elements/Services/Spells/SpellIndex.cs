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

    public static SpellcastingDefinition? ReadSpellcasting(Guid elementId, string rawXml)
    {
        XElement? spellcasting;
        try
        {
            spellcasting = XElement.Parse(rawXml).Element("spellcasting");
        }
        catch (XmlException)
        {
            return null;
        }
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
