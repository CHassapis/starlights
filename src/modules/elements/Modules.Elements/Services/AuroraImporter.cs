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
using Starlights.Modules.Elements.Services.FiveETools;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Services;

/// <summary>
/// Location of the local clone of the Aurora content repository, and top-level folders of it to leave out
/// entirely (e.g. "unearthed-arcana"): never imported, not even to fill a choice.
/// </summary>
public sealed record AuroraImporterOptions(string ContentPath, IReadOnlyList<string>? Exclude = null, string? HomebrewPath = null)
{
    /// <summary>The index name that imports every file in the homebrew folder.</summary>
    public const string HomebrewIndex = "homebrew";

    /// <summary>The index name that imports what is generated from the 5etools data (deities Aurora lacks).</summary>
    public const string FiveEToolsIndex = "5etools";

    /// <summary>The index name that imports Starlights' own content (the generic extras).</summary>
    public const string BuiltInIndex = "starlights";

    public bool IsExcluded(string relativePath) =>
        Exclude?.Any(folder => relativePath.StartsWith(folder.Trim('/') + "/", StringComparison.OrdinalIgnoreCase)) == true;
}

/// <summary>
/// Maps Aurora XML elements onto Starlights elements: grant → include rule, stat → statistic rule,
/// select → selection rule. Rules with a requirements expression (or an equipped condition) are
/// skipped, because the character builder does not evaluate those yet and would apply them unconditionally;
/// the exceptions are conditions that always hold while the builder lacks the feature (see AlwaysMet).
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
    private readonly FiveEToolsData _fiveETools;

    public AuroraImporter(ILogger<AuroraImporter> logger, IPersistence persistence, AuroraImporterOptions options, FiveEToolsData fiveETools)
    {
        _logger = logger;
        _persistence = persistence;
        _options = options;
        _fiveETools = fiveETools;
    }

    public async Task<AuroraImportResult> ImportAsync(string indexPath, bool replace = false, bool update = false, CancellationToken cancellationToken = default)
    {
        using var _ = ElementsInstrumentation.StartActivity();

        var root = Path.GetFullPath(_options.ContentPath);
        var (byId, byFile) = BuildCatalog(root);

        // "homebrew" imports every file of the homebrew folder, "5etools" what is generated from the 5etools data;
        // anything else is an .index of the content repository
        var files = new List<string>();
        if (string.Equals(indexPath, AuroraImporterOptions.HomebrewIndex, StringComparison.OrdinalIgnoreCase))
        {
            files.AddRange(byFile.Keys.Where(f => f.StartsWith(HomebrewPrefix, StringComparison.Ordinal)));
        }
        else if (string.Equals(indexPath, AuroraImporterOptions.FiveEToolsIndex, StringComparison.OrdinalIgnoreCase))
        {
            files.AddRange(byFile.Keys.Where(f => f.StartsWith(FiveEToolsData.Prefix, StringComparison.Ordinal)));
        }
        else if (string.Equals(indexPath, AuroraImporterOptions.BuiltInIndex, StringComparison.OrdinalIgnoreCase))
        {
            files.AddRange(byFile.Keys.Where(f => f.StartsWith(BuiltIn.BuiltInContent.Prefix, StringComparison.Ordinal)));
        }
        else
        {
            var indexFile = Path.GetFullPath(Path.Combine(root, indexPath));
            if (!indexFile.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(indexFile))
            {
                throw new FileNotFoundException($"The index '{indexPath}' was not found in the content repository.");
            }
            CollectIndexFiles(root, indexFile, files, []);
        }

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
            foreach (var rule in element.Rules.Where(r => !IsSkipped(r)))
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

        // choices written as a list of <item>s inside the select (personality traits, ideals, …) become
        // elements of their own, so the builder can offer them like any other option
        foreach (var element in toImport.Values.ToList())
        {
            foreach (var item in ListItems(element))
            {
                toImport.TryAdd(item.Id, item);
            }
        }

        var repository = _persistence.GetRepository<IElementsRepository>();
        var existing = (await repository.GetElementSummariesAsync()).Select(e => e.Id).ToHashSet();

        // replace: re-create everything imported before; update: only what changed upstream. Component ids are
        // derived from the content, so characters built on a re-created element keep working
        var replaced = 0;
        if (replace || update)
        {
            var stored = update && !replace ? await repository.GetAuroraXmlAsync() : null;
            foreach (var aurora in toImport.Values)
            {
                var id = ToElementId(aurora.Id).Value;
                var changed = stored is null || !stored.TryGetValue(id, out var xml) || xml != aurora.Xml.ToString();
                if (changed && existing.Contains(id) && await repository.DeleteElementAsync(id))
                {
                    existing.Remove(id);
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

            // component ids from the element's Aurora id plus what the component is (not its position), so
            // registrations keep pointing at the same rule when upstream adds or reorders rules
            var occurrences = new Dictionary<string, int>();
            T Attach<T>(string key, Func<ElementId, T> create) where T : ElementComponentBase =>
                element.AddComponent(id =>
                {
                    var component = create(id);
                    var n = occurrences[key] = occurrences.GetValueOrDefault(key) + 1;
                    component.SetComponentId(new ElementComponentId(ToGuid($"{aurora.Id}#{key}#{n}")));
                    return component;
                });

            Attach("source", id => new AuroraSourceComponent(id, aurora.Id, aurora.Type, aurora.Source, aurora.File, aurora.Xml.ToString()));

            var description = aurora.Xml.Element("description");
            if (description is not null && description.Nodes().Any())
            {
                var html = string.Concat(description.Nodes().Select(n => n.ToString(SaveOptions.DisableFormatting)));
                Attach("description", id => new DescriptionComponent(id, html));
            }

            if (aurora.Supports.Count > 0)
            {
                Attach("supports", id => new SupportsComponent(id, aurora.Supports));
            }

            foreach (var rule in aurora.Rules)
            {
                if (IsSkipped(rule))
                {
                    skippedConditional++;
                    continue;
                }

                var requirements = RequirementsOf(rule, byId);

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
                        Attach($"grant:{grantId}:{level}", id => new IncludeRuleComponent(id, ToElementId(grantId), level)).UpdateRequirements(requirements);
                        break;

                    case "stat":
                        var statName = (string?)rule.Attribute("name");
                        var statValue = (string?)rule.Attribute("value");
                        if (string.IsNullOrWhiteSpace(statName) || string.IsNullOrWhiteSpace(statValue))
                        {
                            break;
                        }
                        var stat = Attach($"stat:{statName}:{statValue}:{level}", id => new StatisticRuleComponent(id, ToStatisticName(statName), ToStatisticName(statValue), level));
                        stat.UpdateStackingBonus((string?)rule.Attribute("bonus"));
                        stat.UpdateDisplayName((string?)rule.Attribute("alt"));
                        stat.UpdateRequirements(requirements);
                        break;

                    case "select":
                        var selectType = (string?)rule.Attribute("type");
                        var selectName = (string?)rule.Attribute("name");
                        if (string.IsNullOrWhiteSpace(selectType) || string.IsNullOrWhiteSpace(selectName))
                        {
                            break;
                        }
                        var select = Attach($"select:{selectType}:{selectName}:{level}", id => new SelectionRuleComponent(id, MapType(selectType), selectName, level));
                        select.UpdateSupports(rule.Elements("item").Any() ? ListKey(aurora, selectName) : (string?)rule.Attribute("supports"));
                        select.UpdateQuantity(Math.Max(1, ParseInt(rule.Attribute("number")) ?? 1));
                        select.UpdateIsOptional(string.Equals((string?)rule.Attribute("optional"), "true", StringComparison.OrdinalIgnoreCase));
                        select.UpdateRequirements(requirements);
                        break;
                }
            }

            repository.Add(element);
            existing.Add(elementId.Value);
            importedByType[type] = importedByType.GetValueOrDefault(type) + 1;
        }

        await _persistence.SaveChangesAsync();
        Items.ElementsContentVersion.Bump();

        var imported = importedByType.Values.Sum();
        var dependencies = toImport.Count - requestedCount;
        _logger.LogInformation("imported aurora index '{Index}': {Imported} elements ({Replaced} replaced, {Dependencies} pulled in as grant dependencies), {Existing} already present, {Conditional} conditional rules and {Unresolved} unresolved grants skipped",
            indexPath, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved);

        return new AuroraImportResult(files.Count, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved, importedByType);
    }

    public async Task<int> RemoveAsync(string pathPrefix, CancellationToken cancellationToken = default)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var removed = 0;
        foreach (var id in await repository.GetElementIdsByAuroraPathAsync(pathPrefix))
        {
            if (await repository.DeleteElementAsync(id))
            {
                removed++;
            }
        }
        await _persistence.SaveChangesAsync();
        Items.ElementsContentVersion.Bump();

        _logger.LogInformation("removed {Removed} elements imported from '{PathPrefix}'", removed, pathPrefix);
        return removed;
    }

    /// <summary>Folder name homebrew files are filed under (their "file" and their sources group).</summary>
    public const string HomebrewPrefix = "homebrew/";

    /// <summary>
    /// Every element of the content repository and of the homebrew folder (under "homebrew/"), so grants and
    /// choices resolve across both.
    /// </summary>
    private (Dictionary<string, AuroraElement> ById, Dictionary<string, List<AuroraElement>> ByFile) BuildCatalog(string root)
    {
        var byId = new Dictionary<string, AuroraElement>(StringComparer.Ordinal);
        var byFile = new Dictionary<string, List<AuroraElement>>(StringComparer.Ordinal);
        var duplicates = 0;

        var folders = new List<(string Root, string Prefix)> { (root, "") };
        if (_options.HomebrewPath is { } homebrew && Directory.Exists(homebrew))
        {
            folders.Add((Path.GetFullPath(homebrew), HomebrewPrefix));
        }

        void AddDocument(string file, XDocument document)
        {
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

        foreach (var (folder, prefix) in folders)
        foreach (var path in Directory.EnumerateFiles(folder, "*.xml", SearchOption.AllDirectories))
        {
            var file = prefix + Path.GetRelativePath(folder, path).Replace('\\', '/');
            if (file.StartsWith(".git/", StringComparison.Ordinal) || _options.IsExcluded(file))
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

            AddDocument(file, document);
        }

        // Starlights' own extras (an additional feat, language, proficiency, spell)
        AddDocument(BuiltIn.BuiltInContent.Prefix + "extras.xml", BuiltIn.BuiltInContent.ExtrasDocument());

        // the deities Aurora has no entry for, generated from the 5etools data
        if (_fiveETools.Available)
        {
            var deityNames = byId.Values.Where(e => e.Type == "Deity").Select(e => e.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var sources = byId.Values.Select(e => e.Source).OfType<string>().Distinct().ToList();
            if (_fiveETools.DeitiesAsAurora(deityNames, sources) is { } deities)
            {
                AddDocument(FiveEToolsData.Prefix + "deities.xml", deities);
            }
        }

        _logger.LogInformation("aurora catalog: {Elements} elements in {Files} files ({Duplicates} duplicate ids ignored)", byId.Count, byFile.Count, duplicates);
        return (byId, byFile);
    }

    /// <summary>
    /// Walks an .index file and the .index files it lists, collecting the element files (relative to the root).
    /// </summary>
    private void CollectIndexFiles(string root, string indexFile, List<string> files, HashSet<string> visited)
    {
        if (!visited.Add(indexFile) || _options.IsExcluded(Path.GetRelativePath(root, indexFile).Replace('\\', '/')))
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

    // "unless the character has X" where X is something the builder does not offer yet, so it always holds:
    // multiclassing (!ID_WOTC_PHB24_MULTICLASS_FIGHTER), Tasha's customized origin options, optional
    // feature replacements and optional background features. Not "!ID_INTERNAL_GRANTS_BACKGROUND_ASI": whether
    // a background grants the ability score increase really differs between the 2014 and 2024 rules
    private static readonly Regex AlwaysMet = new(
        @"^!(ID_[A-Z0-9_]*MULTICLASS[A-Z0-9_]*|ID_WOTC_TCOE_OPTION_CUSTOMIZED_[A-Z_]+|ID_INTERNAL_PHB24_FEATURE_REPLACEMENT_[A-Z0-9_]+|ID_INTERNAL_GRANT_OPTIONAL_BACKGROUND_FEATURE)$",
        RegexOptions.Compiled);

    // rules that only apply while something is equipped: there is no equipment yet
    private static bool IsSkipped(XElement rule) => rule.Attribute("equipped") is not null;

    private static readonly Regex AuroraId = new(@"ID_[A-Za-z0-9_]+", RegexOptions.Compiled);

    /// <summary>
    /// The rule's requirements for the character processor, with the Aurora ids of imported elements replaced by
    /// their element ids (others stay as they are and count as "not registered"); null when there are none or
    /// they always hold (see AlwaysMet).
    /// </summary>
    private static string? RequirementsOf(XElement rule, Dictionary<string, AuroraElement> catalog)
    {
        var requirements = ((string?)rule.Attribute("requirements"))?.Trim();
        if (string.IsNullOrEmpty(requirements) || AlwaysMet.IsMatch(requirements))
        {
            return null;
        }

        return AuroraId.Replace(requirements, m => catalog.ContainsKey(m.Value) ? ToGuid(m.Value).ToString() : m.Value);
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

    /// <summary>
    /// The supports key tying a list select to its items. Letters, digits and dashes only: the supports parser
    /// reads , | ! ( ) as operators.
    /// </summary>
    private static string ListKey(AuroraElement owner, string selectName) =>
        $"list:{owner.Id}:{Regex.Replace(selectName, "[^A-Za-z0-9]+", "-").Trim('-')}";

    /// <summary>
    /// The items of an element's list selects (e.g. a background's personality traits) as elements of type "List".
    /// </summary>
    private static IEnumerable<AuroraElement> ListItems(AuroraElement owner)
    {
        foreach (var select in owner.Rules.Where(r => r.Name.LocalName == "select" && !IsSkipped(r)))
        {
            var selectName = (string?)select.Attribute("name");
            if (string.IsNullOrWhiteSpace(selectName))
            {
                continue;
            }

            var key = ListKey(owner, selectName);
            var index = 0;
            foreach (var item in select.Elements("item"))
            {
                index++;
                var text = item.Value.Trim();
                if (text.Length > 0)
                {
                    // the item's own id when it has one, so upstream inserting an item does not shift existing picks
                    var itemId = (string?)item.Attribute("id") ?? index.ToString();
                    yield return new AuroraElement($"{key}:{itemId}", text, "List", owner.Source, owner.File, item) { Supports = [key] };
                }
            }
        }
    }

    internal static ElementId ToElementId(string auroraId) => new(ToGuid(auroraId));

    private static Guid ToGuid(string name)
    {
        byte[] input = [.. IdNamespace.ToByteArray(bigEndian: true), .. Encoding.UTF8.GetBytes(name)];
        var hash = SHA1.HashData(input);
        hash[6] = (byte)((hash[6] & 0x0F) | 0x50); // version 5
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80); // RFC 4122 variant
        return new Guid(hash.AsSpan(0, 16), bigEndian: true);
    }

    private sealed record AuroraElement(string Id, string Name, string Type, string? Source, string File, XElement Xml)
    {
        public IEnumerable<XElement> Rules => Xml.Element("rules")?.Elements() ?? [];

        public List<string> Supports { get; init; } = ((string?)Xml.Element("supports"))?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList() ?? [];
    }
}
