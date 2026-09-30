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
}

public sealed record ElementSummary(Guid Id, string Name, string Type, string? Source);
