using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Services.Items;

/// <summary>
/// Bumped whenever imported content changes (an import, an update, a homebrew file added or removed), so caches
/// built from the content know to rebuild.
/// </summary>
public static class ElementsContentVersion
{
    private static long _version = 1;

    public static long Current => Interlocked.Read(ref _version);

    public static void Bump() => Interlocked.Increment(ref _version);
}

/// <summary>
/// The item catalog, built from the imported Aurora XML once per content version and kept in memory (a few
/// thousand items; building takes well under a second).
/// </summary>
internal sealed class ItemCatalog : IItemCatalog
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<ItemCatalog> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private ItemCatalogSnapshot? _snapshot;

    public ItemCatalog(IServiceScopeFactory scopes, ILogger<ItemCatalog> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    public async Task<ItemCatalogSnapshot> GetAsync(CancellationToken cancellationToken = default)
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
            var elements = await repository.GetAuroraElementsAsync(ItemClassifier.ItemTypes);
            var names = await repository.GetAuroraNamesAsync();

            var items = new List<ItemInfo>(elements.Count);
            foreach (var element in elements)
            {
                try
                {
                    items.Add(ItemClassifier.Classify(element.Id, element.Name, element.AuroraType, element.AuroraId, element.Source, element.RawXml, names.GetValueOrDefault));
                }
                catch (System.Xml.XmlException ex)
                {
                    _logger.LogWarning("item '{Name}' ({AuroraId}) could not be read: {Error}", element.Name, element.AuroraId, ex.Message);
                }
            }

            _snapshot = new ItemCatalogSnapshot(version, items.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ToList());
            _logger.LogInformation("item catalog built: {Count} items (content version {Version})", items.Count, version);
            return _snapshot;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<List<ItemInfo>> GetBaseCandidatesAsync(Guid magicItemId, CancellationToken cancellationToken = default)
    {
        var snapshot = await GetAsync(cancellationToken);
        var item = snapshot.Find(magicItemId);
        if (item?.Base is not { } rule)
        {
            return [];
        }

        var candidates = snapshot.Items.Where(i => rule.Kind == "Weapon" ? i.Weapon is not null && i.Magic is null : i.Armor is not null && i.Magic is null);
        if (rule.Rule.Contains("ID_", StringComparison.Ordinal))
        {
            // a supports expression over the weapon categories or armor groups ("…SIMPLE_MELEE||…MARTIAL_MELEE")
            var supportsByItem = await SupportsAsync(snapshot, cancellationToken);
            var matches = SupportsExpression.Compile(rule.Rule);
            return candidates.Where(i => matches(supportsByItem.GetValueOrDefault(i.Id, []), i.AuroraId)).ToList();
        }

        // an item named outright: "Quarterstaff", "Plate" (the 2024 "Plate Armor")
        return candidates
            .Where(i => i.Name.Equals(rule.Rule, StringComparison.OrdinalIgnoreCase)
                || i.Name.Equals($"{rule.Rule} Armor", StringComparison.OrdinalIgnoreCase)
                || i.Name.StartsWith($"{rule.Rule} (", StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    private Dictionary<Guid, IReadOnlyList<string>>? _supports;
    private long _supportsVersion;

    private async Task<Dictionary<Guid, IReadOnlyList<string>>> SupportsAsync(ItemCatalogSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (_supports is not null && _supportsVersion == snapshot.Version)
        {
            return _supports;
        }

        using var scope = _scopes.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<IElementsRepository>();
        var elements = await repository.GetAuroraElementsAsync(["Weapon", "Armor"]);
        _supports = elements.ToDictionary(
            e => e.Id,
            e => (IReadOnlyList<string>)(System.Xml.Linq.XElement.Parse(e.RawXml).Element("supports")?.Value ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        _supportsVersion = snapshot.Version;
        return _supports;
    }
}
