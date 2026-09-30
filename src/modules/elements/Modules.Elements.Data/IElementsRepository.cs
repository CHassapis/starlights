using Starlights.Modules.Elements.Domain;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Data;

public interface IElementsRepository : IRepository
{
    /// <summary>
    /// Adds a new element to the repository.
    /// </summary>
    void Add(Element element);

    /// <summary>
    /// Deletes an element by its identifier.
    /// </summary>
    Task<bool> DeleteElementAsync(Guid identifier);

    /// <summary>
    /// Retrieves an element by its identifier.
    /// </summary>
    /// <param name="identifier">The unique identifier of the element.</param>
    /// <returns>The element if found; otherwise, null.</returns>
    Task<Element?> GetElementAsync(Guid identifier);

    /// <summary>
    /// Retrieves all elements.
    /// </summary>
    Task<List<Element>> GetElementsAsync();

    /// <summary>
    /// Retrieves all elements of a specific type.
    /// </summary>
    /// <param name="type">The type of elements to retrieve.</param>
    /// <returns>A collection of elements of the specified type.</returns>
    Task<List<Element>> GetElementsByTypeAsync(string type);

    /// <summary>
    /// Retrieves all elements of specified types.
    /// </summary>
    Task<List<Element>> GetElementsByTypesAsync(IEnumerable<string> types);

    /// <summary>
    /// Retrieves the id, name, type and (for imported content) source book of every element,
    /// without loading components — for lists over the whole content set.
    /// </summary>
    Task<List<ElementSummary>> GetElementSummariesAsync();

    /// <summary>The imported elements of the given Aurora types (as written in the XML), with their XML.</summary>
    Task<List<AuroraElementXml>> GetAuroraElementsAsync(IReadOnlyCollection<string> auroraTypes);

    /// <summary>The original Aurora XML of the given elements (those imported from Aurora).</summary>
    Task<Dictionary<Guid, string>> GetAuroraXmlByIdsAsync(IReadOnlyCollection<Guid> elementIds);

    /// <summary>Every imported element's name by its Aurora id.</summary>
    Task<Dictionary<string, string>> GetAuroraNamesAsync();

    /// <summary>
    /// Retrieves several elements (with components) in one query.
    /// </summary>
    Task<List<Element>> GetElementsByIdsAsync(IReadOnlyCollection<Guid> identifiers);

    /// <summary>
    /// The original Aurora XML of every imported element, by element id — to see which ones changed upstream.
    /// </summary>
    Task<Dictionary<Guid, string>> GetAuroraXmlAsync();

    /// <summary>
    /// The ids of the elements imported from Aurora files under a path (e.g. "unearthed-arcana/").
    /// </summary>
    Task<List<Guid>> GetElementIdsByAuroraPathAsync(string pathPrefix);

    /// <summary>
    /// Source book and file of every imported element, for the list of sources a character can tick.
    /// </summary>
    Task<List<(string? Source, string File)>> GetAuroraSourcesAsync();

    /// <summary>
    /// Element ids by Aurora id, for the given Aurora ids that were imported.
    /// </summary>
    Task<Dictionary<string, Guid>> GetElementIdsByAuroraIdsAsync(IReadOnlyCollection<string> auroraIds);

    /// <summary>
    /// The requirement expressions of all include, statistic and selection rules that have one.
    /// </summary>
    Task<List<string>> GetRuleRequirementsAsync();
}

public sealed record ElementSummary(Guid Id, string Name, string Type, string? Source);

/// <summary>An imported element with its original Aurora XML.</summary>
public sealed record AuroraElementXml(Guid Id, string Name, string AuroraId, string AuroraType, string? Source, string RawXml);
