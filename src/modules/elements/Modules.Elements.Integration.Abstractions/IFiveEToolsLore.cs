namespace Starlights.Modules.Elements.Integration;

/// <summary>
/// A piece of setting lore from the 5etools data: its name, the book it comes from, the group it is listed
/// under there, and its text as simple HTML.
/// </summary>
public sealed record LoreEntry(string Name, string Source, string Group, string Html);

/// <summary>
/// Lore from the 5etools data release, for what the Aurora content has nothing on.
/// </summary>
public interface IFiveEToolsLore
{
    /// <summary>Whether the 5etools data folder is there at all.</summary>
    bool Available { get; }

    /// <summary>The factions and organizations of the Forgotten Realms (Heroes of Faerûn, 2025).</summary>
    IReadOnlyList<LoreEntry> GetOrganizations();
}
