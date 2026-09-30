using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Services;

/// <summary>
/// Location of the local clone of the Aurora content repository.
/// </summary>
public sealed record AuroraImporterOptions(string ContentPath);

/// <summary>
/// Maps Aurora XML elements onto Starlights elements: grant → include rule, stat → statistic rule,
/// select → selection rule. Rules with a requirements expression (or an equipped condition) are
/// skipped, because the character builder does not evaluate those yet and would apply them unconditionally;
/// the exception is "not as a multiclass", which always holds while there is no multiclassing.
/// </summary>
internal sealed class AuroraImporter : IAuroraImporter
{
    // Aurora type names that Starlights spells differently; applied to element types and to select rules alike
    private static readonly Dictionary<string, string> TypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Race"] = ElementTypeConstants.Species,
        ["Racial Trait"] = ElementTypeConstants.SpeciesFeature,
        ["Archetype"] = ElementTypeConstants.SubClass,
    };

    // namespace for the deterministic (UUIDv5) element ids derived from Aurora ids, so grants
    // across files resolve to the same element and re-running an import does not duplicate anything
    private static readonly Guid IdNamespace = new("8a4c4f1e-2b7d-4d52-9d0e-6f3b2a9c7e11");

    private readonly ILogger<AuroraImporter> _logger;
    private readonly IPersistence _persistence;
    private readonly AuroraImporterOptions _options;

    public AuroraImporter(ILogger<AuroraImporter> logger, IPersistence persistence, AuroraImporterOptions options)
    {
        _logger = logger;
        _persistence = persistence;
        _options = options;
    }

    public async Task<AuroraImportResult> ImportAsync(string indexPath, bool replace = false, CancellationToken cancellationToken = default)
    {
        using var _ = ElementsInstrumentation.StartActivity();

        var root = Path.GetFullPath(_options.ContentPath);
        var indexFile = Path.GetFullPath(Path.Combine(root, indexPath));
        if (!indexFile.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(indexFile))
        {
            throw new FileNotFoundException($"The index '{indexPath}' was not found in the content repository.");
        }

        var (byId, byFile) = BuildCatalog(root);

        var files = new List<string>();
        CollectIndexFiles(root, indexFile, files, []);

        // the requested elements, then (transitively) everything they grant from anywhere in the repository,
        // plus the options for choices that nothing in the import can satisfy (e.g. gaming sets for the Soldier)
        var toImport = new Dictionary<string, AuroraElement>(StringComparer.Ordinal);
        var importByType = new Dictionary<string, List<AuroraElement>>(StringComparer.OrdinalIgnoreCase);
        var catalogByType = byId.Values
            .GroupBy(e => e.Type, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<AuroraElement>();

        void Add(AuroraElement element)
        {
            if (toImport.TryAdd(element.Id, element))
            {
                importByType.TryAdd(element.Type, []);
                importByType[element.Type].Add(element);
                queue.Enqueue(element);
            }
        }

        foreach (var file in files)
        {
            byFile.GetValueOrDefault(file, []).ForEach(Add);
        }
        var requestedCount = toImport.Count;

        while (queue.TryDequeue(out var element))
        {
            foreach (var rule in element.Rules.Where(r => !IsConditional(r)))
            {
                if (rule.Name.LocalName == "grant")
                {
                    if ((string?)rule.Attribute("id") is { } id && byId.TryGetValue(id, out var dependency))
                    {
                        Add(dependency);
                    }
                }
                else if (rule.Name.LocalName == "select")
                {
                    // dynamic ($(...)) expressions would match everything of the type, so those are left alone
                    var type = (string?)rule.Attribute("type");
                    var supports = (string?)rule.Attribute("supports");
                    if (type is null || string.IsNullOrWhiteSpace(supports) || supports.Contains("$(", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var matches = SupportsExpression.Compile(supports);
                    if (!importByType.GetValueOrDefault(type, []).Any(e => matches(e.Supports, e.Id)))
                    {
                        catalogByType.GetValueOrDefault(type, []).Where(e => matches(e.Supports, e.Id)).ToList().ForEach(Add);
                    }
                }
            }
        }

        var repository = _persistence.GetRepository<IElementsRepository>();
        var existing = (await repository.GetElementSummariesAsync()).Select(e => e.Id).ToHashSet();

        var replaced = 0;
        if (replace)
        {
            foreach (var aurora in toImport.Values)
            {
                var id = ToElementId(aurora.Id).Value;
                if (existing.Remove(id) && await repository.DeleteElementAsync(id))
                {
                    replaced++;
                }
            }
            await _persistence.SaveChangesAsync();
        }

        int alreadyImported = 0, skippedConditional = 0, skippedUnresolved = 0;
        var importedByType = new SortedDictionary<string, int>();

        foreach (var aurora in toImport.Values)
        {
            var elementId = ToElementId(aurora.Id);
            if (existing.Contains(elementId.Value))
            {
                alreadyImported++;
                continue;
            }

            var type = MapType(aurora.Type);
            var element = Element.Create(aurora.Name, type);
            element.SetElementId(elementId);

            element.AddComponent(id => new AuroraSourceComponent(id, aurora.Id, aurora.Type, aurora.Source, aurora.File, aurora.Xml.ToString()));

            var description = aurora.Xml.Element("description");
            if (description is not null && description.Nodes().Any())
            {
                var html = string.Concat(description.Nodes().Select(n => n.ToString(SaveOptions.DisableFormatting)));
                element.AddComponent(id => new DescriptionComponent(id, html));
            }

            if (aurora.Supports.Count > 0)
            {
                element.AddComponent(id => new SupportsComponent(id, aurora.Supports));
            }

            foreach (var rule in aurora.Rules)
            {
                if (IsConditional(rule))
                {
                    skippedConditional++;
                    continue;
                }

                var level = Math.Max(0, ParseInt(rule.Attribute("level")) ?? 0);

                switch (rule.Name.LocalName)
                {
                    case "grant":
                        var grantId = (string?)rule.Attribute("id");
                        if (grantId is null || !(toImport.ContainsKey(grantId) || existing.Contains(ToElementId(grantId).Value)))
                        {
                            skippedUnresolved++;
                            break;
                        }
                        element.AddComponent(id => new IncludeRuleComponent(id, ToElementId(grantId), level));
                        break;

                    case "stat":
                        var statName = (string?)rule.Attribute("name");
                        var statValue = (string?)rule.Attribute("value");
                        if (string.IsNullOrWhiteSpace(statName) || string.IsNullOrWhiteSpace(statValue))
                        {
                            break;
                        }
                        var stat = element.AddComponent(id => new StatisticRuleComponent(id, ToStatisticName(statName), ToStatisticName(statValue), level));
                        stat.UpdateStackingBonus((string?)rule.Attribute("bonus"));
                        stat.UpdateDisplayName((string?)rule.Attribute("alt"));
                        break;

                    case "select":
                        var selectType = (string?)rule.Attribute("type");
                        var selectName = (string?)rule.Attribute("name");
                        if (string.IsNullOrWhiteSpace(selectType) || string.IsNullOrWhiteSpace(selectName))
                        {
                            break;
                        }
                        var select = element.AddComponent(id => new SelectionRuleComponent(id, MapType(selectType), selectName, level));
                        select.UpdateSupports((string?)rule.Attribute("supports"));
                        select.UpdateQuantity(Math.Max(1, ParseInt(rule.Attribute("number")) ?? 1));
                        select.UpdateIsOptional(string.Equals((string?)rule.Attribute("optional"), "true", StringComparison.OrdinalIgnoreCase));
                        break;
                }
            }

            repository.Add(element);
            existing.Add(elementId.Value);
            importedByType[type] = importedByType.GetValueOrDefault(type) + 1;
        }

        await _persistence.SaveChangesAsync();

        var imported = importedByType.Values.Sum();
        var dependencies = toImport.Count - requestedCount;
        _logger.LogInformation("imported aurora index '{Index}': {Imported} elements ({Replaced} replaced, {Dependencies} pulled in as grant dependencies), {Existing} already present, {Conditional} conditional rules and {Unresolved} unresolved grants skipped",
            indexPath, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved);

        return new AuroraImportResult(files.Count, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved, importedByType);
    }

    private (Dictionary<string, AuroraElement> ById, Dictionary<string, List<AuroraElement>> ByFile) BuildCatalog(string root)
    {
        var byId = new Dictionary<string, AuroraElement>(StringComparer.Ordinal);
        var byFile = new Dictionary<string, List<AuroraElement>>(StringComparer.Ordinal);
        var duplicates = 0;

        foreach (var path in Directory.EnumerateFiles(root, "*.xml", SearchOption.AllDirectories))
        {
            var file = Path.GetRelativePath(root, path).Replace('\\', '/');
            if (file.StartsWith(".git/", StringComparison.Ordinal))
            {
                continue;
            }

            XDocument document;
            try
            {
                document = XDocument.Load(path);
            }
            catch (XmlException ex)
            {
                _logger.LogWarning("skipping unreadable aurora file '{File}': {Error}", file, ex.Message);
                continue;
            }

            var elements = new List<AuroraElement>();
            foreach (var xml in document.Descendants("element"))
            {
                var id = (string?)xml.Attribute("id");
                var name = (string?)xml.Attribute("name");
                var type = (string?)xml.Attribute("type");
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(type))
                {
                    continue;
                }

                var element = new AuroraElement(id, name, type, (string?)xml.Attribute("source"), file, xml);
                elements.Add(element);
                if (!byId.TryAdd(id, element))
                {
                    duplicates++;
                }
            }
            byFile[file] = elements;
        }

        _logger.LogInformation("aurora catalog: {Elements} elements in {Files} files ({Duplicates} duplicate ids ignored)", byId.Count, byFile.Count, duplicates);
        return (byId, byFile);
    }

    /// <summary>
    /// Walks an .index file and the .index files it lists, collecting the element files (relative to the root).
    /// </summary>
    private void CollectIndexFiles(string root, string indexFile, List<string> files, HashSet<string> visited)
    {
        if (!visited.Add(indexFile))
        {
            return;
        }

        foreach (var entry in XDocument.Load(indexFile).Descendants("files").Elements("file"))
        {
            var name = (string?)entry.Attribute("name");
            var url = (string?)entry.Attribute("url");
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var path = ResolveIndexEntry(root, name, url);
            if (path is null)
            {
                _logger.LogWarning("index '{Index}' lists '{Name}' which is not in the content repository", Path.GetRelativePath(root, indexFile), name);
                continue;
            }

            if (path.EndsWith(".index", StringComparison.OrdinalIgnoreCase))
            {
                CollectIndexFiles(root, path, files, visited);
            }
            else
            {
                files.Add(Path.GetRelativePath(root, path).Replace('\\', '/'));
            }
        }
    }

    /// <summary>
    /// Index entries carry a raw.githubusercontent.com url; the part after the branch name is the path in the clone.
    /// </summary>
    private static string? ResolveIndexEntry(string root, string name, string? url)
    {
        foreach (var branch in new[] { "/master/", "/main/" })
        {
            var at = url?.IndexOf(branch, StringComparison.Ordinal) ?? -1;
            if (at >= 0)
            {
                var candidate = Path.GetFullPath(Path.Combine(root, url![(at + branch.Length)..]));
                if (candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) && File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return Directory.EnumerateFiles(root, Path.GetFileName(name), SearchOption.AllDirectories).FirstOrDefault();
    }

    // the builder has no multiclassing yet, so "not as a multiclass" (e.g. !ID_WOTC_PHB24_MULTICLASS_FIGHTER) always holds
    private static readonly Regex NotMulticlass = new(@"^!ID_[A-Z0-9_]*MULTICLASS[A-Z0-9_]*$", RegexOptions.Compiled);

    private static bool IsConditional(XElement rule)
    {
        var requirements = ((string?)rule.Attribute("requirements"))?.Trim();
        return rule.Attribute("equipped") is not null || (requirements is not null && !NotMulticlass.IsMatch(requirements));
    }

    private static int? ParseInt(XAttribute? attribute) => int.TryParse(attribute?.Value, out var value) ? value : null;

    private static readonly Regex AuroraSave = new(@"^(strength|dexterity|constitution|intelligence|wisdom|charisma):save\b", RegexOptions.Compiled);
    private static readonly Regex AuroraClassLevel = new(@"^level:(?!half\b)([a-z][a-z-]*)(:.*)?$", RegexOptions.Compiled);

    /// <summary>
    /// Aurora statistic names to the Starlights convention (lowercase, spaces as hyphens, saves named after the
    /// saving throw element, class level as "&lt;class&gt;:level"): "animal handling:proficiency" →
    /// "animal-handling:proficiency", "strength:save:proficiency" → "strength-saving-throw:proficiency",
    /// "level:wizard:half" → "wizard:level:half". Numbers pass through.
    /// </summary>
    private static string ToStatisticName(string auroraName)
    {
        var name = auroraName.Trim().ToLowerInvariant();
        name = AuroraSave.Replace(name, "$1-saving-throw").Replace(' ', '-');
        return AuroraClassLevel.Replace(name, "$1:level$2");
    }

    private static string MapType(string auroraType) => TypeMap.GetValueOrDefault(auroraType.Trim(), auroraType.Trim());

    internal static ElementId ToElementId(string auroraId)
    {
        byte[] input = [.. IdNamespace.ToByteArray(bigEndian: true), .. Encoding.UTF8.GetBytes(auroraId)];
        var hash = SHA1.HashData(input);
        hash[6] = (byte)((hash[6] & 0x0F) | 0x50); // version 5
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80); // RFC 4122 variant
        return new ElementId(new Guid(hash.AsSpan(0, 16), bigEndian: true));
    }

    private sealed record AuroraElement(string Id, string Name, string Type, string? Source, string File, XElement Xml)
    {
        public IEnumerable<XElement> Rules => Xml.Element("rules")?.Elements() ?? [];

        public List<string> Supports { get; } = ((string?)Xml.Element("supports"))?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList() ?? [];
    }
}
