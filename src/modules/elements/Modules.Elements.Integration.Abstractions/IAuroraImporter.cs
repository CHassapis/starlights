namespace Starlights.Modules.Elements.Integration;

/// <summary>
/// Imports elements from a local clone of an Aurora content repository (e.g. github.com/AuroraLegacy/elements).
/// </summary>
public interface IAuroraImporter
{
    /// <summary>
    /// Imports the elements listed by an Aurora .index file (following nested index files), plus any
    /// elements from elsewhere in the repository that they grant, so every include rule resolves, and the
    /// options for choices that nothing in the index can satisfy.
    /// </summary>
    /// <param name="indexPath">Path of the .index file, relative to the content repository root.</param>
    /// <param name="replace">
    /// Delete and re-create elements that were imported before (to pick up content or importer changes).
    /// Rule components get new ids, so characters built on the old elements need to be recreated.
    /// </param>
    Task<AuroraImportResult> ImportAsync(string indexPath, bool replace = false, CancellationToken cancellationToken = default);
}

public record AuroraImportResult(
    int FilesRead,
    int ElementsImported,
    int ElementsReplaced,
    int DependenciesImported,
    int AlreadyImported,
    int SkippedConditionalRules,
    int SkippedUnresolvedGrants,
    IReadOnlyDictionary<string, int> ImportedByType);
