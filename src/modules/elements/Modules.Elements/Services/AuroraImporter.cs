using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Transactions;
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
public sealed record AuroraImporterOptions(string ContentPath, IReadOnlyList<string>? Exclude = null, string? HomebrewPath = null, string? PullRequestsPath = null)
{
    /// <summary>
    /// The index name that imports the content of Aurora Legacy's open pull requests (books not merged yet), which
    /// scripts/starlights-aurora-prs.sh lays out in the pull-requests folder, one folder per pull request.
    /// </summary>
    public const string PullRequestsIndex = "pull-requests";

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
/// select → selection rule. A rule's requirements expression and its equipped condition ("[armor:none]") become
/// the rule's requirements, which the character processor evaluates (equipment terms against what the character
/// has equipped); conditions that always hold while the builder lacks the feature are dropped (see AlwaysMet).
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

    // written on every element's stored XML: an update re-creates an element whose XML changed, so raising this when
    // the importer makes something new of the same XML (2: appends and every element's prerequisites) re-creates them
    // all once, with no --replace needed
    private const string ImportVersion = "2";

    // Persisted with raw XML so removed/retargeted patches can refresh their former targets.
    private const string HomebrewAppendMarker = "starlights-homebrew-append";

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
        var (byId, byFile, warnings) = BuildCatalog(root);
        var repository = _persistence.GetRepository<IElementsRepository>();
        var homebrewImport = string.Equals(indexPath, AuroraImporterOptions.HomebrewIndex, StringComparison.OrdinalIgnoreCase);
        var storedXml = homebrewImport && (update || replace) ? await repository.GetAuroraXmlAsync() : null;

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
        else if (string.Equals(indexPath, AuroraImporterOptions.PullRequestsIndex, StringComparison.OrdinalIgnoreCase))
        {
            files.AddRange(byFile.Keys.Where(f => f.StartsWith(PullRequestsPrefix, StringComparison.Ordinal)));
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

        // the copy of each id that counts (see Precedence), whichever file of the index repeats it, so every index
        // imports the same copy and an update does not swap it back and forth
        foreach (var file in files)
        {
            byFile.GetValueOrDefault(file, []).ForEach(e => Add(byId.GetValueOrDefault(e.Id, e)));
        }
        if (homebrewImport)
        {
            // Append-only files have no definitions in byFile. Include their targets and the former targets
            // recorded in stored XML, so replacing/removing a patch also removes its old contributions.
            foreach (var element in byId.Values)
            {
                if (element.Xml.Attribute(HomebrewAppendMarker) is not null
                    || (storedXml is not null && storedXml.TryGetValue(ToElementId(element.Id).Value, out var previous)
                        && previous.Contains(HomebrewAppendMarker + "=", StringComparison.Ordinal)))
                    Add(element);
            }
        }
        var requestedCount = toImport.Count;

        while (queue.TryDequeue(out var element))
        {
            foreach (var rule in element.Rules)
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

        // Replacement needs two saves to remove tracked entities before adding their stable IDs again.
        // Keep both saves in one transaction so a failed rebuild cannot commit only the deletions.
        using var transaction = new TransactionScope(TransactionScopeOption.Required,
            new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted, Timeout = TransactionManager.MaximumTimeout },
            TransactionScopeAsyncFlowOption.Enabled);
        var existing = (await repository.GetElementSummariesAsync()).Select(e => e.Id).ToHashSet();

        // replace: re-create everything imported before; update: only what changed upstream. Component ids are
        // derived from the content, so characters built on a re-created element keep working
        var replaced = 0;
        if (replace || update)
        {
            var stored = update && !replace ? storedXml ?? await repository.GetAuroraXmlAsync() : null;
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
        ILookup<(string, string), string>? sameName = null;
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

            // "allow duplicate": the same option may be picked again (the same ability twice for +2, a feat taken twice)
            if (aurora.Xml.Element("setters")?.Elements("set").Any(set =>
                    (string?)set.Attribute("name") == "allow duplicate" && string.Equals(set.Value.Trim(), "true", StringComparison.OrdinalIgnoreCase)) == true)
            {
                Attach("repeatable", id => new RepeatableComponent(id, isRepeatable: true));
            }

            // what the element asks of the character, in words ("Strength 13 or Dexterity 13", "Artificer Level 6+")
            // and as the expression that checks it, so a choice can tell which of its options the character qualifies for
            var prerequisite = ((string?)(aurora.Xml.Element("prerequisite") ?? aurora.Xml.Element("prerequisites")))?.Trim();
            if (prerequisite?.Length > 256)
            {
                prerequisite = prerequisite[..256]; // the column's size; Aurora's longest is about 80
            }
            var ownRequirements = ((string?)aurora.Xml.Element("requirements"))?.Trim();
            if (aurora.Type == "Feat")
            {
                ownRequirements = AnyEdition(ownRequirements, byId, sameName ??= SameName(byId));
            }
            var check = Convert(ownRequirements, byId);
            if (!string.IsNullOrEmpty(prerequisite) || check is not null)
            {
                Attach("prerequisites", id =>
                {
                    var component = new PrerequisitesComponent(id, prerequisite ?? string.Empty);
                    component.UpdateRequirements(check ?? string.Empty);
                    return component;
                });
            }

            foreach (var rule in aurora.Rules)
            {
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
        transaction.Complete();
        Items.ElementsContentVersion.Bump();

        var imported = importedByType.Values.Sum();
        var dependencies = toImport.Count - requestedCount;
        _logger.LogInformation("imported aurora index '{Index}': {Imported} elements ({Replaced} replaced, {Dependencies} pulled in as grant dependencies), {Existing} already present, {Conditional} conditional rules and {Unresolved} unresolved grants skipped",
            indexPath, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved);

        return new AuroraImportResult(files.Count, imported, replaced, dependencies, alreadyImported, skippedConditional, skippedUnresolved, importedByType) { Warnings = warnings };
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

    /// <summary>Folder name the open pull requests' files are filed under (their "file" and their sources group).</summary>
    public const string PullRequestsPrefix = "pull-requests/";

    /// <summary>
    /// Every element of the content repository and of the homebrew folder (under "homebrew/"), so grants and
    /// choices resolve across both.
    /// </summary>
    private (Dictionary<string, AuroraElement> ById, Dictionary<string, List<AuroraElement>> ByFile, List<string> Warnings) BuildCatalog(string root)
    {
        var byId = new Dictionary<string, AuroraElement>(StringComparer.Ordinal);
        var byFile = new Dictionary<string, List<AuroraElement>>(StringComparer.Ordinal);
        var duplicates = 0;

        var folders = new List<(string Root, string Prefix)> { (root, "") };
        if (_options.HomebrewPath is { } homebrew && Directory.Exists(homebrew))
        {
            folders.Add((Path.GetFullPath(homebrew), HomebrewPrefix));
        }
        // where a pull request or homebrew repeats an id, its copy counts (see Precedence)
        if (_options.PullRequestsPath is { } pulls && Directory.Exists(pulls))
        {
            folders.Add((Path.GetFullPath(pulls), PullRequestsPrefix));
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

                xml.SetAttributeValue("starlights-import", ImportVersion);
                var element = new AuroraElement(id, name, type, (string?)xml.Attribute("source"), file, xml);
                elements.Add(element);
                if (byId.TryGetValue(id, out var other))
                {
                    duplicates++;
                    if (Precedence(file) > Precedence(other.File))
                    {
                        byId[id] = element;
                    }
                }
                else
                {
                    byId[id] = element;
                }

                // a class taken as an additional class: its <multiclass> becomes an element of its own ("Fighter
                // (multiclass)") that grants the class; the class's starting grants marked "!ID_…_MULTICLASS_FIGHTER"
                // (saving throws, skills, some armor) stay off for a character who has it
                foreach (var multiclass in xml.Elements("multiclass"))
                {
                    var multiclassId = (string?)multiclass.Attribute("id");
                    if (string.IsNullOrWhiteSpace(multiclassId))
                    {
                        continue;
                    }
                    var synthetic = Multiclass(multiclass, multiclassId, id, name, (string?)xml.Attribute("source"));
                    var multiclassElement = new AuroraElement(multiclassId, (string)synthetic.Attribute("name")!, "Multiclass", (string?)xml.Attribute("source"), file, synthetic);
                    elements.Add(multiclassElement);
                    if (!byId.TryGetValue(multiclassId, out var otherMulticlass) || Precedence(file) > Precedence(otherMulticlass.File))
                    {
                        byId[multiclassId] = multiclassElement;
                    }
                }
            }
            byFile[file] = elements;
        }

        var documents = new List<(string File, XDocument Document)>();
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

            documents.Add((file, document));
        }

        // appends first, so every element is read with what other files add to it (Starlights' corrections among them)
        documents.Add((BuiltIn.BuiltInContent.Prefix + "fixes.xml", BuiltIn.BuiltInContent.FixesDocument()));
        var (appended, unmatched) = ApplyAppends(documents);

        // feats whose prerequisite Aurora only describes are checked with what 5etools records for them
        if (_fiveETools.Available)
        {
            var elements = documents.SelectMany(d => d.Document.Descendants("element")).Where(e => e.Attribute("id") is not null && e.Attribute("name") is not null && e.Attribute("type") is not null).ToList();
            _fiveETools.FillFeatRequirements(
                // no requirements, or requirements but no prerequisite at all (the 2014 War Caster's spellcasting)
                elements.Where(e => (string?)e.Attribute("type") == "Feat"
                    && (e.Element("requirements") is null || e.Element("prerequisite") is null && e.Element("prerequisites") is null)),
                elements.Select(e => new FiveETools.AuroraCatalogElement((string)e.Attribute("id")!, (string)e.Attribute("name")!, (string)e.Attribute("type")!,
                    (string?)e.Attribute("source"), ((string?)e.Element("supports"))?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [], e)));
        }
        foreach (var (file, document) in documents)
        {
            AddDocument(file, document);
        }

        // Starlights' own extras (an additional feat, language, proficiency, spell), and the damage conditions the Aurora app has built in
        AddDocument(BuiltIn.BuiltInContent.Prefix + "extras.xml", BuiltIn.BuiltInContent.ExtrasDocument());
        AddDocument(BuiltIn.BuiltInContent.Prefix + "conditions.xml", BuiltIn.BuiltInContent.ConditionsDocument());

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

        // what the 5etools data has and all of the above lacks (a book Aurora Legacy has not added yet), translated
        if (_fiveETools.Available
            && _fiveETools.ContentAsAurora(byId.Values.Select(e => new FiveETools.AuroraCatalogElement(e.Id, e.Name, e.Type, e.Source, e.Supports, e.Xml))) is { } content)
        {
            AddDocument(FiveEToolsData.Prefix + "content.xml", content);
        }

        // a class's Ability Score Improvement levels ask for an "Improvement Option" (2014 classes): the Aurora app makes
        // the answers itself (increase abilities, or take a feat), so they are generated for every such choice no file answers
        if (ImprovementOptions(byId.Values.ToList()) is { } improvements)
        {
            AddDocument(BuiltIn.BuiltInContent.Prefix + "improvement-options.xml", improvements);
        }

        _logger.LogInformation("aurora catalog: {Elements} elements in {Files} files ({Duplicates} duplicate ids ignored, {Appended} appends applied, {Unmatched} appends for elements not loaded)",
            byId.Count, byFile.Count, duplicates, appended, unmatched);
        var warnings = documents.Where(d => d.File.StartsWith(HomebrewPrefix, StringComparison.Ordinal))
            .SelectMany(d => HomebrewUploadXml.AppendTargets(d.Document).Where(id => !byId.TryGetValue(id, out var target) || target.Xml.Attribute(HomebrewAppendMarker) is null)
                .Select(id => $"{d.File}: append target {id} was not found in the loaded Aurora source files. Install its source content, then upload this patch again."))
            .ToList();
        return (byId, byFile, warnings);
    }

    /// <summary>
    /// Which copy of an id counts when files repeat it: homebrew (the user's own) over an open pull request (the newest
    /// first: a pull request repeating merged elements changes them, as the TCoE Artificer's spellcasting fix does) over
    /// the merged content; among equals the first. When a pull request is merged or closed its copies go, and the merged
    /// ones count again.
    /// </summary>
    private static double Precedence(string file)
    {
        if (file.StartsWith(HomebrewPrefix, StringComparison.Ordinal))
        {
            return 2;
        }
        if (file.StartsWith(PullRequestsPrefix, StringComparison.Ordinal))
        {
            var folder = file[PullRequestsPrefix.Length..].Split('/')[0];
            return 1 + (int.TryParse(folder.Replace("pr-", "", StringComparison.Ordinal), out var number) ? number / 1_000_000.0 : 0);
        }
        return 0;
    }

    /// <summary>
    /// Aurora's &lt;append id="…"&gt;: a file adds to an element that another file defines. The 2024 Artificer puts
    /// "Artificer" on the skills it may choose and the spells on its list; a subclass adds a choice to a class feature
    /// (the Armorer's extra plan, the Thief's Cunning Strike option); a book puts its weapons under a proficiency group
    /// (the musket and pistol under martial ranged weapons). Supports and rules are merged into every copy of the
    /// element, in file order, so the merged XML, which an update compares, is the same on every run.
    /// </summary>
    private static (int Applied, int Unmatched) ApplyAppends(List<(string File, XDocument Document)> documents)
    {
        var elements = documents
            .SelectMany(d => d.Document.Descendants("element"))
            .Where(e => e.Attribute("id") is not null)
            .ToLookup(e => (string)e.Attribute("id")!, StringComparer.Ordinal);

        int applied = 0, unmatched = 0;
        foreach (var (file, append) in documents.OrderBy(d => d.File, StringComparer.Ordinal)
            .SelectMany(d => d.Document.Descendants("append").Select(a => (d.File, a))))
        {
            var targets = elements[(string?)append.Attribute("id") ?? string.Empty].ToList();
            if (targets.Count == 0)
            {
                unmatched++;
                continue;
            }

            var supports = SupportsTokens((string?)append.Element("supports"));
            var appendedRules = append.Element("rules")?.Elements().ToList() ?? [];
            foreach (var target in targets)
            {
                if (file.StartsWith(HomebrewPrefix, StringComparison.Ordinal))
                    target.SetAttributeValue(HomebrewAppendMarker, "true");
                if (supports.Count > 0)
                {
                    if (target.Element("supports") is { } existing)
                    {
                        var have = SupportsTokens(existing.Value);
                        var missing = supports.Where(t => !have.Contains(t, StringComparer.OrdinalIgnoreCase)).ToList();
                        if (missing.Count > 0)
                        {
                            existing.Value = string.Join(",", have.Concat(missing));
                        }
                    }
                    else
                    {
                        target.Add(new XElement("supports", string.Join(",", supports)));
                    }
                }

                if (appendedRules.Count > 0)
                {
                    var rules = target.Element("rules");
                    if (rules is null)
                    {
                        target.Add(rules = new XElement("rules"));
                    }
                    // the same append can come twice (a pull request repeating a merged file)
                    foreach (var rule in appendedRules.Where(a => !rules.Elements().Any(r => XNode.DeepEquals(r, a))))
                    {
                        rules.Add(new XElement(rule));
                    }
                }
            }
            applied++;
        }
        return (applied, unmatched);
    }

    private static List<string> SupportsTokens(string? supports) =>
        supports?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList() ?? [];

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
    // Tasha's customized origin options, optional
    // feature replacements and optional background features. Not "!ID_INTERNAL_GRANTS_BACKGROUND_ASI": whether
    // a background grants the ability score increase really differs between the 2014 and 2024 rules
    private static readonly Regex AlwaysMet = new(
        @"^!(ID_WOTC_TCOE_OPTION_CUSTOMIZED_[A-Z_]+|ID_INTERNAL_PHB24_FEATURE_REPLACEMENT_[A-Z0-9_]+|ID_INTERNAL_GRANT_OPTIONAL_BACKGROUND_FEATURE)$",
        RegexOptions.Compiled);

    // an equipped condition's terms ("[armor:none]", "[primary:versatile]") as requirement terms the processor
    // answers from the character's equipment: "[equipped:armor:none]"
    private static readonly Regex EquippedTerm = new(@"\[([^\]]+)\]", RegexOptions.Compiled);

    private static string? EquippedOf(XElement rule)
    {
        var equipped = ((string?)rule.Attribute("equipped"))?.Trim();
        return string.IsNullOrEmpty(equipped) ? null : EquippedTerm.Replace(equipped, m => $"[equipped:{m.Groups[1].Value.Trim().ToLowerInvariant()}]");
    }

    private static readonly Regex AuroraId = new(@"ID_[A-Za-z0-9_]+", RegexOptions.Compiled);

    /// <summary>
    /// The rule's requirements for the character processor, with the Aurora ids of imported elements replaced by
    /// their element ids (others stay as they are and count as "not registered"); null when there are none or
    /// they always hold (see AlwaysMet).
    /// </summary>
    private static string? RequirementsOf(XElement rule, Dictionary<string, AuroraElement> catalog)
    {
        var requirements = ((string?)rule.Attribute("requirements"))?.Trim();
        var converted = string.IsNullOrEmpty(requirements) || AlwaysMet.IsMatch(requirements)
            ? null
            : AuroraId.Replace(requirements, m => catalog.ContainsKey(m.Value) ? ToGuid(m.Value).ToString() : m.Value);
        var equipped = EquippedOf(rule);
        return (converted, equipped) switch
        {
            (null, null) => null,
            (null, _) => equipped,
            (_, null) => converted,
            _ => $"({converted}),({equipped})",
        };
    }

    // the classes and species by type and name, for AnyEdition
    private static ILookup<(string, string), string> SameName(Dictionary<string, AuroraElement> catalog) =>
        catalog.Values.Where(e => e.Type is "Class" or "Race").ToLookup(e => (e.Type, e.Name), e => e.Id);

    /// <summary>
    /// A feat's prerequisite of a class or species ("ID_PHB_CLASS_WIZARD", "ID_RACE_ELF") as that class or species of
    /// any edition: Initiate of High Sorcery asks for the Wizard, the 2024 Wizard too; Elven Accuracy for an Elf.
    /// </summary>
    private static string? AnyEdition(string? expression, Dictionary<string, AuroraElement> catalog, ILookup<(string, string), string> sameName) =>
        string.IsNullOrEmpty(expression) ? expression : AuroraId.Replace(expression, m =>
            catalog.TryGetValue(m.Value, out var element) && element.Type is "Class" or "Race" && sameName[(element.Type, element.Name)].Distinct().ToList() is { Count: > 1 } all
                ? $"({string.Join("||", all.Order(StringComparer.Ordinal))})"
                : m.Value);

    // Aurora ids of imported elements as their element ids, the others left as they are
    private static string? Convert(string? expression, Dictionary<string, AuroraElement> catalog) =>
        string.IsNullOrEmpty(expression) ? null : AuroraId.Replace(expression, m => catalog.ContainsKey(m.Value) ? ToGuid(m.Value).ToString() : m.Value);

    /// <summary>The element for taking a class as an additional class, from the class's &lt;multiclass&gt;.</summary>
    private static XElement Multiclass(XElement multiclass, string multiclassId, string classId, string className, string? source)
    {
        var prerequisite = ((string?)multiclass.Element("prerequisite"))?.Trim();
        var proficiencies = multiclass.Element("setters")?.Elements("set").FirstOrDefault(s => (string?)s.Attribute("name") == "multiclass proficiencies")?.Value.Trim();
        var text = $"Take {className} as an additional class.";
        if (!string.IsNullOrEmpty(prerequisite)) text += $" Prerequisite: {prerequisite}.";
        if (!string.IsNullOrEmpty(proficiencies)) text += $" You gain these proficiencies: {proficiencies}.";
        return new XElement("element",
            new XAttribute("name", $"{className} (multiclass)"),
            new XAttribute("type", "Multiclass"),
            new XAttribute("source", source ?? string.Empty),
            new XAttribute("id", multiclassId),
            new XElement("description", new XElement("p", text)),
            new XElement("prerequisite", prerequisite ?? string.Empty),
            multiclass.Element("requirements") is { } requirements ? new XElement("requirements", requirements.Value) : null,
            new XElement("rules",
                (multiclass.Element("rules")?.Elements() ?? []).Select(rule => new XElement(rule)),
                new XElement("grant", new XAttribute("type", "Class"), new XAttribute("id", classId))));
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
        foreach (var select in owner.Rules.Where(r => r.Name.LocalName == "select"))
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

    private static readonly string[] AbilityNames = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

    /// <summary>
    /// The answers to "Improvement Option, {class}, {level}" choices that no file has: for each, "Ability Score
    /// Improvement ({class} {level})" (two +1s, the same ability twice for +2) and "Feat ({class} {level})", with the
    /// ids the Aurora app gives them (so characters saved by Aurora import), and the six +1 options they choose from.
    /// Null when nothing is missing.
    /// </summary>
    private static XDocument? ImprovementOptions(List<AuroraElement> all)
    {
        var generated = new List<XElement>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var owner in all)
        foreach (var select in owner.Rules.Where(r => r.Name.LocalName == "select" && (string?)r.Attribute("type") == "Class Feature"))
        {
            var tokens = ((string?)select.Attribute("supports") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (tokens.Length != 3 || !tokens[0].Equals("Improvement Option", StringComparison.OrdinalIgnoreCase) || !seen.Add(string.Join(",", tokens)))
            {
                continue;
            }
            // answered by a file already (the artificer's own)
            if (all.Any(e => tokens.All(t => e.Supports.Contains(t, StringComparer.OrdinalIgnoreCase))))
            {
                continue;
            }
            var (className, level) = (tokens[1], tokens[2]);
            var key = $"{IdPart(className)}_{IdPart(level)}";
            var supports = new XElement("supports", $"Improvement Option, {className}, {level}");
            generated.Add(new XElement("element",
                new XAttribute("name", $"Ability Score Improvement ({className} {level})"),
                new XAttribute("type", "Class Feature"),
                new XAttribute("source", owner.Source ?? "Internal"),
                new XAttribute("id", $"ID_INTERNAL_CLASS_FEATURE_ASI_{key}"),
                supports,
                new XElement("description", new XElement("p", "Increase one ability score by 2, or two ability scores by 1 each (pick the same ability twice for +2). As a rule, a score can't go above 20 this way.")),
                new XElement("sheet", new XAttribute("display", "false")),
                new XElement("rules", new XElement("select",
                    new XAttribute("type", "Ability Score Improvement"),
                    new XAttribute("name", $"Ability Score Improvement ({className} {level})"),
                    new XAttribute("supports", "Ability Score Improvement, Class"),
                    new XAttribute("number", "2")))));
            generated.Add(new XElement("element",
                new XAttribute("name", $"Feat ({className} {level})"),
                new XAttribute("type", "Class Feature"),
                new XAttribute("source", owner.Source ?? "Internal"),
                new XAttribute("id", $"ID_INTERNAL_CLASS_FEATURE_FEAT_{key}"),
                new XElement(supports),
                new XElement("description", new XElement("p", "Instead of increasing your ability scores, take a feat.")),
                new XElement("sheet", new XAttribute("display", "false")),
                new XElement("rules", new XElement("select",
                    new XAttribute("type", "Feat"),
                    new XAttribute("name", $"Feat ({className} {level})")))));
        }
        if (generated.Count == 0)
        {
            return null;
        }
        // the +1 to an ability those choose from (the app's own; no file has them)
        foreach (var ability in AbilityNames)
        {
            var id = $"ID_INTERNAL_ASI_{ability.ToUpperInvariant()}";
            if (all.Any(e => e.Id == id))
            {
                continue;
            }
            generated.Add(new XElement("element",
                new XAttribute("name", ability),
                new XAttribute("type", "Ability Score Improvement"),
                new XAttribute("source", "Player’s Handbook"),
                new XAttribute("id", id),
                new XElement("supports", $"Ability Score Improvement, Class, {ability}"),
                new XElement("description", new XElement("p", $"Your {ability} increases by 1.")),
                new XElement("sheet", new XAttribute("display", "false")),
                new XElement("setters", new XElement("set", new XAttribute("name", "allow duplicate"), "true")),
                new XElement("rules", new XElement("stat", new XAttribute("name", ability.ToLowerInvariant()), new XAttribute("value", "1"), new XAttribute("alt", "Ability Score Increase")))));
        }
        return new XDocument(new XElement("elements", generated));

        static string IdPart(string text) => System.Text.RegularExpressions.Regex.Replace(text.ToUpperInvariant(), "[^A-Z0-9]+", "_").Trim('_');
    }

    private sealed record AuroraElement(string Id, string Name, string Type, string? Source, string File, XElement Xml)
    {
        public IEnumerable<XElement> Rules => Xml.Element("rules")?.Elements() ?? [];

        public List<string> Supports { get; init; } = [
            .. ((string?)Xml.Element("supports"))?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [],
            .. CompanionTerms(Xml)];

        // a companion is chosen by its creature type, size and challenge ("Beast,(Tiny||Small||Medium),(1/4||1/8||0)" for
        // the Beast Master), which Aurora keeps in its setters
        private static IEnumerable<string> CompanionTerms(XElement xml) =>
            (string?)xml.Attribute("type") != "Companion"
                ? []
                : xml.Element("setters")?.Elements("set")
                    .Where(s => (string?)s.Attribute("name") is "type" or "size" or "challenge")
                    .Select(s => s.Value.Trim())
                    .Where(v => v.Length > 0) ?? [];
    }
}
