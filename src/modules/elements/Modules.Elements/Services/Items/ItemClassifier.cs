using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Services.Items;

/// <summary>
/// Describes one Aurora item element (Item, Weapon, Armor, Magic Item) for the inventory. Aurora keeps one
/// "category" per item (the compendium filter: Adventuring Gear, Magic Weapons, Rings, …); items are often more
/// than one thing, so the categories are completed from the rest of the element: a magic weapon is also a weapon,
/// a Ring-type magic item is a ring, a "Spell Scroll" is a spell scroll, a holy symbol is a spellcasting focus.
/// </summary>
public static partial class ItemClassifier
{
    public static readonly string[] ItemTypes = ["Item", "Weapon", "Armor", "Magic Item"];

    /// <summary>Aurora files features and ability score increases as "items" in these categories.</summary>
    public static readonly HashSet<string> BuildOptionCategories = ["Optional Class Features", "Additional Feature", "Additional Ability Score Improvement"];

    // a magic item's "type" setter and the category it adds
    private static readonly Dictionary<string, string> MagicTypeCategory = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Ring"] = "Rings",
        ["Potion"] = "Potions",
        ["Elixir"] = "Potions",
        ["Wand"] = "Wands",
        ["Wands"] = "Wands",
        ["Rod"] = "Rods",
        ["Staff"] = "Staffs",
        ["Scroll"] = "Scrolls",
        ["Weapon"] = "Magic Weapons",
        ["Melee Weapon"] = "Magic Weapons",
        ["Armor"] = "Magic Armor",
        ["Wondrous Item"] = "Wondrous Items",
        ["Wondrous Items"] = "Wondrous Items",
        ["Tattoo"] = "Wondrous Items",
        ["Supernatural Gift"] = "Supernatural Gifts",
        ["Blessing"] = "Supernatural Gifts",
        ["Charm"] = "Supernatural Gifts",
        ["Epic Boon"] = "Supernatural Gifts",
        ["Draconic Gift"] = "Supernatural Gifts",
    };

    // the rulebooks' container capacities (Aurora has no setter for them); a stash setter (Bag of Holding) wins
    private static readonly Dictionary<string, decimal> ContainerCapacity = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Backpack"] = 30,
        ["Basket"] = 40,
        ["Chest"] = 300,
        ["Pouch"] = 6,
        ["Sack"] = 30,
    };

    private static readonly string[] Abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

    public static ItemInfo Classify(Guid id, string name, string elementType, string auroraId, string? source, string rawXml, Func<string, string?> nameOfAuroraId)
    {
        var xml = XElement.Parse(rawXml);
        var setters = xml.Element("setters")?.Elements("set").Where(s => s.Attribute("name") is not null).ToList() ?? [];
        string? Set(string key) => setters.FirstOrDefault(s => (string)s.Attribute("name")! == key)?.Value.Trim() is { Length: > 0 } v ? v : null;
        string? Attr(string key, string attribute) => (string?)setters.FirstOrDefault(s => (string)s.Attribute("name")! == key)?.Attribute(attribute);
        var supports = (xml.Element("supports")?.Value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var rules = xml.Element("rules")?.Elements().ToList() ?? [];

        var magic = elementType == "Magic Item";
        var category = System.Net.WebUtility.HtmlDecode(Set("category") ?? string.Empty);
        var type = Set("type");

        // categories: Aurora's own first, then what the rest of the element says it also is
        var categories = new List<string>();
        void AddCategory(string? c)
        {
            if (!string.IsNullOrWhiteSpace(c) && !categories.Contains(c))
            {
                categories.Add(c);
            }
        }
        AddCategory(category);
        if (magic && type is not null && MagicTypeCategory.TryGetValue(type, out var fromType))
        {
            AddCategory(fromType);
        }
        if (elementType == "Weapon" || categories.Contains("Magic Weapons"))
        {
            AddCategory("Weapons");
        }
        if (elementType == "Armor" || categories.Contains("Magic Armor"))
        {
            AddCategory("Armor");
        }
        if (name.StartsWith("Spell Scroll", StringComparison.OrdinalIgnoreCase))
        {
            AddCategory("Spell Scrolls");
        }
        if (Set("container") is not null || category == "Spellcasting Focus")
        {
            AddCategory("Spellcasting Focus");
        }
        if (string.Equals(type, "Ammunition", StringComparison.OrdinalIgnoreCase))
        {
            AddCategory("Ammunition");
        }
        if (type?.EndsWith("Poison", StringComparison.OrdinalIgnoreCase) == true)
        {
            AddCategory("Poison");
        }
        if (categories.Count == 0)
        {
            AddCategory(magic ? "Wondrous Items" : "Adventuring Gear");
        }

        var weapon = WeaponOf(Set, Attr, supports);
        var armor = ArmorOf(Set);
        var magicInfo = magic
            ? new MagicInfo(
                Set("rarity"),
                string.Equals(Set("attunement"), "true", StringComparison.OrdinalIgnoreCase),
                Attr("attunement", "addition"),
                int.TryParse(Set("charges"), out var charges) ? charges : null,
                string.Equals(Set("cursed"), "true", StringComparison.OrdinalIgnoreCase),
                int.TryParse(Set("enhancement"), out var enhancement) ? enhancement : null)
            : null;

        // a magic item made from a weapon or armor ("Weapon, +1", "Flame Tongue", "Plate Armor of Etherealness");
        // a magic shield or armor that is already armor itself ("Armor" setter Light/…) is not
        BaseItemInfo? baseItem = null;
        if (magic && Set("weapon") is { } weaponRule)
        {
            baseItem = new BaseItemInfo("Weapon", weaponRule, Set("name-format"));
        }
        else if (magic && Set("armor") is { } armorRule && armor is null)
        {
            baseItem = new BaseItemInfo("Armor", armorRule, Set("name-format"));
        }

        ContainerInfo? container = null;
        if (Set("stash") is not null)
        {
            container = new ContainerInfo(
                decimal.TryParse(Attr("stash", "lb"), NumberStyles.Number, CultureInfo.InvariantCulture, out var stash) ? stash : null,
                string.Equals(Attr("stash", "weightless"), "true", StringComparison.OrdinalIgnoreCase),
                false);
        }
        else if (string.Equals(type, "Mount", StringComparison.OrdinalIgnoreCase) || string.Equals(type, "Vehicle", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Saddlebags", StringComparison.OrdinalIgnoreCase))
        {
            container = new ContainerInfo(null, false, true);
        }
        else if (!magic && ContainerCapacity.TryGetValue(name, out var capacity))
        {
            container = new ContainerInfo(capacity, false, false);
        }

        return new ItemInfo
        {
            Id = id,
            Name = name,
            ElementType = elementType,
            Source = source,
            AuroraId = auroraId,
            Categories = categories,
            Magic = magicInfo,
            BuildOption = BuildOptionCategories.Contains(category),
            Hidden = string.Equals(Set("inventory-hidden"), "true", StringComparison.OrdinalIgnoreCase),
            Weight = Number(Attr("weight", "lb")) ?? Number(Set("weight")) ?? 0,
            ExcludeEncumbrance = string.Equals(Attr("weight", "excludeEncumbrance"), "true", StringComparison.OrdinalIgnoreCase),
            Cost = Number(Set("cost")),
            Currency = Attr("cost", "currency"),
            Stackable = string.Equals(Set("stackable"), "true", StringComparison.OrdinalIgnoreCase),
            Valuable = string.Equals(Set("valuable"), "true", StringComparison.OrdinalIgnoreCase),
            Slot = Set("slot"),
            Weapon = weapon,
            Armor = armor,
            Base = baseItem,
            Container = container,
            HasRules = rules.Any(r => r.Name.LocalName is "grant" or "select" or "stat"),
            Effects = Effects(rules, magicInfo, baseItem, nameOfAuroraId),
        };
    }

    private static decimal? Number(string? text)
    {
        var match = text is null ? null : NumberRegex().Match(text);
        return match is { Success: true } && decimal.TryParse(match.Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var n) ? n : null;
    }

    private static WeaponInfo? WeaponOf(Func<string, string?> set, Func<string, string, string?> attr, string[] supports)
    {
        if (set("damage") is not { } damage)
        {
            return null;
        }

        var category = supports.FirstOrDefault(s => s.StartsWith("ID_INTERNAL_WEAPON_CATEGORY_", StringComparison.Ordinal));
        var properties = supports
            .Select(s => WeaponPropertyRegex().Match(s))
            .Where(m => m.Success)
            .Select(m => m.Groups[1].Value switch
            {
                "TWOHANDED" => "Two-Handed",
                var p => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(p.Replace('_', ' ').ToLowerInvariant()),
            })
            .ToList();
        var range = set("range");
        return new WeaponInfo(
            damage,
            attr("damage", "type") ?? supports.Select(s => DamageTypeRegex().Match(s)).FirstOrDefault(m => m.Success)?.Groups[1].Value.ToLowerInvariant(),
            set("versatile"),
            range?.Split(';')[0].Trim(),
            properties,
            category?.Contains("MARTIAL", StringComparison.Ordinal) == true,
            category?.EndsWith("RANGED", StringComparison.Ordinal) == true,
            set("proficiency"),
            set("ammunition"));
    }

    private static ArmorInfo? ArmorOf(Func<string, string?> set)
    {
        var kind = set("armor");
        if (kind is not ("Light" or "Medium" or "Heavy" or "Shield"))
        {
            return null;
        }

        var armorClass = (int)(Number(set("armorClass")?.TrimStart('+')) ?? (kind == "Shield" ? 2 : 10));
        return new ArmorInfo(
            kind,
            armorClass,
            int.TryParse(set("strength"), out var strength) ? strength : null,
            string.Equals(set("stealth"), "Disadvantage", StringComparison.OrdinalIgnoreCase),
            set("proficiency"));
    }

    // ---- what an item does, in words

    private static List<string> Effects(List<XElement> rules, MagicInfo? magic, BaseItemInfo? baseItem, Func<string, string?> nameOfAuroraId)
    {
        var effects = new List<string>();
        if (magic?.Enhancement is { } bonus && baseItem?.Kind == "Weapon")
        {
            effects.Add($"+{bonus} to attack and damage rolls");
        }

        var stats = rules
            .Where(r => r.Name.LocalName == "stat" && r.Attribute("requirements") is null && r.Attribute("equipped") is null)
            .Select(r => (Name: ((string?)r.Attribute("name") ?? string.Empty).ToLowerInvariant(), Value: (string?)r.Attribute("value") ?? string.Empty))
            .ToList();
        int? Numeric(string value) => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;
        string Signed(int n) => n >= 0 ? $"+{n}" : $"{n}";

        // saving throws: all six alike reads as "all saving throws"
        var saves = stats.Where(s => s.Name.EndsWith(":save:misc", StringComparison.Ordinal) && Numeric(s.Value) is not null).ToList();
        if (saves.Count == 6 && saves.Select(s => s.Value).Distinct().Count() == 1)
        {
            effects.Add($"{Signed(Numeric(saves[0].Value)!.Value)} to all saving throws");
        }
        else
        {
            effects.AddRange(saves.Select(s => $"{Signed(Numeric(s.Value)!.Value)} to {Title(s.Name.Split(':')[0])} saving throws"));
        }

        var skills = stats.Where(s => s.Name.EndsWith(":misc", StringComparison.Ordinal) && !s.Name.Contains(":save:", StringComparison.Ordinal)
            && !s.Name.StartsWith("ac:", StringComparison.Ordinal) && !s.Name.StartsWith("speed", StringComparison.Ordinal) && Numeric(s.Value) is not null).ToList();
        if (skills.Count >= 10)
        {
            effects.Add($"{Signed(Numeric(skills[0].Value)!.Value)} to ability checks");
        }
        else
        {
            effects.AddRange(skills.Select(s => $"{Signed(Numeric(s.Value)!.Value)} to {Title(s.Name.Split(':')[0])} checks"));
        }

        foreach (var (statName, value) in stats)
        {
            var n = Numeric(value);
            var parts = statName.Split(':');
            switch (statName)
            {
                case "ac:misc" or "ac:armored:enhancement" or "ac:shield" when n is not null:
                    effects.Add($"{Signed(n.Value)} AC");
                    break;
                case "initiative" when n is not null:
                    effects.Add($"{Signed(n.Value)} to initiative");
                    break;
                case "hp" when n is not null:
                    effects.Add($"{Signed(n.Value)} hit points");
                    break;
                case "spellcasting:attack" when n is not null:
                    effects.Add($"{Signed(n.Value)} to spell attack rolls");
                    break;
                case "spellcasting:dc" when n is not null:
                    effects.Add($"{Signed(n.Value)} to spell save DC");
                    break;
                default:
                    if (parts.Length == 3 && parts[1] == "spellcasting" && parts[2] is "attack" or "dc" && n is not null)
                    {
                        effects.Add($"{Signed(n.Value)} to {Title(parts[0])} spell {(parts[2] == "dc" ? "save DC" : "attack rolls")}");
                    }
                    else if (parts.Length == 3 && Abilities.Contains(parts[0]) && parts[1] == "score" && parts[2] == "set" && n is not null)
                    {
                        effects.Add($"{Title(parts[0])} becomes {n} (unless it is higher)");
                    }
                    else if (parts.Length == 1 && Abilities.Contains(parts[0]) && n is not null)
                    {
                        effects.Add($"{Signed(n.Value)} {Title(parts[0])}");
                    }
                    else if (parts.Length >= 2 && Abilities.Contains(parts[0]) && parts[1] == "max" && n is not null)
                    {
                        effects.Add($"{Title(parts[0])} maximum {Signed(n.Value)}");
                    }
                    else if (parts.Length == 2 && parts[0] is "speed" or "innate speed" && parts[1] is "fly" or "swim" or "climb" or "burrow")
                    {
                        effects.Add(n is not null ? $"{Title(parts[1])} speed {n} ft." : $"{Title(parts[1])} speed equal to your walking speed");
                    }
                    else if (statName is "speed:misc" or "innate speed" && n is not null)
                    {
                        effects.Add($"{Signed(n.Value)} ft. walking speed");
                    }
                    else if (parts.Length == 2 && parts[1] == "range" && parts[0] is "darkvision" or "blindsight" or "truesight" or "tremorsense" && n is not null)
                    {
                        effects.Add($"{Title(parts[0])} {n} ft.");
                    }
                    break;
            }
        }

        // what it grants, by kind
        var grants = rules.Where(r => r.Name.LocalName == "grant" && r.Attribute("requirements") is null)
            .Select(r => (Type: (string?)r.Attribute("type") ?? string.Empty, Id: (string?)r.Attribute("id") ?? string.Empty))
            .ToList();
        string Names(IEnumerable<string> ids) => JoinWords(ids.Select(i => nameOfAuroraId(i) ?? ConditionName(i)).Where(n => n is not null).Distinct()!);
        if (grants.Where(g => g.Type == "Spell").Select(g => g.Id).ToList() is { Count: > 0 } spells)
        {
            effects.Add($"You can cast {Names(spells)}");
        }
        if (grants.Where(g => g.Type == "Language").Select(g => g.Id).ToList() is { Count: > 0 } languages)
        {
            effects.Add($"You know {Names(languages)}");
        }
        if (grants.Where(g => g.Type == "Proficiency").Select(g => g.Id).ToList() is { Count: > 0 } proficiencies)
        {
            effects.Add($"Proficiency: {Names(proficiencies)}");
        }
        if (grants.Where(g => g.Type == "Condition").Select(g => g.Id).ToList() is { Count: > 0 } conditions)
        {
            effects.AddRange(conditions.Select(c => nameOfAuroraId(c) ?? ConditionName(c)).OfType<string>().Distinct());
        }
        if (grants.Where(g => g.Type == "Vision").Select(g => g.Id).ToList() is { Count: > 0 } visions)
        {
            effects.AddRange(visions.Select(v => nameOfAuroraId(v)).OfType<string>().Where(v => !effects.Any(e => e.StartsWith(v, StringComparison.Ordinal))).Distinct());
        }

        return effects.Distinct().ToList();
    }

    /// <summary>Aurora's built-in conditions by id: ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE → "Resistance to fire damage".</summary>
    public static string? ConditionName(string auroraId)
    {
        var match = ConditionRegex().Match(auroraId);
        if (!match.Success)
        {
            return null;
        }
        var what = match.Groups[2].Value.Replace('_', ' ').ToLowerInvariant();
        return match.Groups[1].Value switch
        {
            "DAMAGE_RESISTANCE" => $"Resistance to {what} damage",
            "DAMAGE_IMMUNITY" => $"Immunity to {what} damage",
            "DAMAGE_VULNERABILITY" => $"Vulnerability to {what} damage",
            "CONDITION_IMMUNITY" => $"Immune to being {what}",
            _ => null,
        };
    }

    private static string Title(string text) => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(text.Replace('-', ' '));

    private static string JoinWords(IEnumerable<string> words)
    {
        var list = words.ToList();
        return list.Count <= 1 ? string.Concat(list) : $"{string.Join(", ", list.Take(list.Count - 1))} and {list[^1]}";
    }

    [GeneratedRegex(@"-?\d+(\.\d+)?")]
    private static partial Regex NumberRegex();

    [GeneratedRegex(@"^ID_INTERNAL_WEAPON_PROPERTY_([A-Z_]+)$")]
    private static partial Regex WeaponPropertyRegex();

    [GeneratedRegex(@"^ID_INTERNAL_DAMAGE_TYPE_([A-Z]+)$")]
    private static partial Regex DamageTypeRegex();

    [GeneratedRegex(@"^ID_INTERNAL_CONDITION_(DAMAGE_RESISTANCE|DAMAGE_IMMUNITY|DAMAGE_VULNERABILITY|CONDITION_IMMUNITY)_([A-Z_]+)$")]
    private static partial Regex ConditionRegex();
}
