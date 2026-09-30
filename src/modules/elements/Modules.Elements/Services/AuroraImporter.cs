using System.Security.Cryptography;
using System.Text;
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
/// skipped, because the character builder does not evaluate those yet and would apply them unconditionally.
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

    public async Task<AuroraImportResult> ImportAsync(string indexPath, CancellationToken cancellationToken = default)
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

        // the requested elements, then everything they grant (transitively) from anywhere in the repository
        var toImport = new Dictionary<string, AuroraElement>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            foreach (var element in byFile.GetValueOrDefault(file, []))
            {
                toImport.TryAdd(element.Id, element);
            }
        }
        var requestedCount = toImport.Count;

        var queue = new Queue<AuroraElement>(toImport.Values);
        while (queue.TryDequeue(out var element))
        {
            foreach (var grant in element.Rules.Where(r => r.Name.LocalName == "grant" && !IsConditional(r)))
            {
                var id = (string?)grant.Attribute("id");
                if (id is not null && !toImport.ContainsKey(id) && byId.TryGetValue(id, out var dependency))
                {
                    toImport.Add(id, dependency);
                    queue.Enqueue(dependency);
                }
            }
        }

        var repository = _persistence.GetRepository<IElementsRepository>();
        var existing = (await repository.GetElementsAsync()).Select(e => e.Id.Value).ToHashSet();

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

            var supports = ((string?)aurora.Xml.Element("supports"))?
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();
            if (supports is { Count: > 0 })
            {
                element.AddComponent(id => new SupportsComponent(id, supports));
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
                        var stat = element.AddComponent(id => new StatisticRuleComponent(id, statName, statValue, level));
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
        _logger.LogInformation("imported aurora index '{Index}': {Imported} new elements ({Dependencies} pulled in as grant dependencies), {Existing} already present, {Conditional} conditional rules and {Unresolved} unresolved grants skipped",
            indexPath, imported, dependencies, alreadyImported, skippedConditional, skippedUnresolved);

        return new AuroraImportResult(files.Count, imported, dependencies, alreadyImported, skippedConditional, skippedUnresolved, importedByType);
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

    private static bool IsConditional(XElement rule) => rule.Attribute("requirements") is not null || rule.Attribute("equipped") is not null;

    private static int? ParseInt(XAttribute? attribute) => int.TryParse(attribute?.Value, out var value) ? value : null;

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
    }
}
