using System.Xml.Linq;

namespace Starlights.Modules.Elements.Services.BuiltIn;

/// <summary>
/// Starlights' own content, written as Aurora elements so the same importer handles it (deterministic ids,
/// update-safe): the generic extras the Aurora app offers but Aurora Legacy's data does not have (an additional feat,
/// language, proficiency or spell), filed like Aurora's own "Additional Feature" items so the extras flow lists them
/// with those.
/// </summary>
public static class BuiltInContent
{
    /// <summary>Folder name the built-in elements are filed under (their "file"); its import index is "starlights".</summary>
    public const string Prefix = "starlights/";

    public const string Source = "Starlights";

    private static readonly (string Id, string Name, string Type, string? Supports, string Description)[] Extras =
    [
        ("FEAT", "Additional Feat", "Feat", null, "Choose a feat you meet the prerequisites for."),
        ("LANGUAGE", "Additional Language", "Language", null, "You learn a language of your choice."),
        ("PROFICIENCY", "Additional Proficiency", "Proficiency", "Skill||Tool||Weapon||Armor", "You gain proficiency with a skill, tool, weapon or armor of your choice."),
        ("SPELL", "Additional Spell", "Spell", null, "You learn a spell of your choice (your DM decides how you can cast it)."),
        ("WIZARD_SPELL", "Additional Wizard Spell", "Spell", "Wizard", "You learn a wizard spell of your choice, for example one copied into your spellbook."),
    ];

    public static XDocument ExtrasDocument() =>
        new(new XElement("elements",
            Extras.Select(e => new XElement("element",
                new XAttribute("name", e.Name),
                new XAttribute("type", "Item"),
                new XAttribute("source", Source),
                new XAttribute("id", $"ID_STARLIGHTS_EXTRA_{e.Id}"),
                new XElement("description", new XElement("p", e.Description)),
                new XElement("setters",
                    new XElement("set", new XAttribute("name", "category"), "Additional Feature"),
                    new XElement("set", new XAttribute("name", "inventory-hidden"), "true")),
                new XElement("rules",
                    new XElement("select",
                        new XAttribute("type", e.Type),
                        new XAttribute("name", e.Name),
                        e.Supports is null ? null : new XAttribute("supports", e.Supports)))))));
}
