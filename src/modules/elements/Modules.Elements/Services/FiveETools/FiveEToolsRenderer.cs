using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace Starlights.Modules.Elements.Services.FiveETools;

/// <summary>
/// Turns 5etools "entries" (nested JSON of paragraphs, named sections, lists, tables and quotes, with inline
/// {@tag text|source|display} references) into the same small XHTML the Aurora descriptions use: p, h5, ul/li,
/// table, blockquote, strong and em. References become their display text; images and stat blocks are left out.
/// </summary>
internal static class FiveEToolsRenderer
{
    public static List<XNode> Entries(JsonElement entries)
    {
        var nodes = new List<XNode>();
        if (entries.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in entries.EnumerateArray())
            {
                nodes.AddRange(Entry(entry));
            }
        }
        else
        {
            nodes.AddRange(Entry(entries));
        }
        return nodes;
    }

    public static string ToHtml(IEnumerable<XNode> nodes) =>
        string.Concat(nodes.Select(n => n.ToString(SaveOptions.DisableFormatting)));

    private static IEnumerable<XNode> Entry(JsonElement entry)
    {
        if (entry.ValueKind == JsonValueKind.String)
        {
            yield return new XElement("p", Inline(entry.GetString() ?? string.Empty));
            yield break;
        }
        if (entry.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }

        var type = Text(entry, "type") ?? "entries";
        var name = Text(entry, "name");
        switch (type)
        {
            case "list":
                yield return new XElement("ul", Items(entry).Select(ListItem));
                break;

            case "table":
                if (Table(entry) is { } table)
                {
                    yield return table;
                }
                break;

            case "quote":
                var quote = new XElement("blockquote", Children(entry));
                if (Text(entry, "by") is { } by)
                {
                    quote.Add(new XElement("p", new XElement("em", Inline("— " + by))));
                }
                yield return quote;
                break;

            case "inset":
            case "insetReadaloud":
                var inset = new XElement("blockquote");
                if (name is not null)
                {
                    inset.Add(new XElement("p", new XElement("strong", Inline(name))));
                }
                inset.Add(Children(entry));
                yield return inset;
                break;

            case "image":
            case "gallery":
            case "statblock":
            case "statblockInline":
            case "hr":
            case "flowchart":
                break;

            case "item":
                // a named list item outside a list ("Name. text")
                yield return new XElement("p", ItemContent(entry));
                break;

            default:
                if (name is not null)
                {
                    yield return new XElement("h5", Inline(name));
                }
                foreach (var node in Children(entry))
                {
                    yield return node;
                }
                break;
        }
    }

    private static List<XNode> Children(JsonElement entry)
    {
        var nodes = new List<XNode>();
        if (entry.TryGetProperty("entries", out var entries))
        {
            nodes.AddRange(Entries(entries));
        }
        if (entry.TryGetProperty("entry", out var single))
        {
            nodes.AddRange(Entries(single));
        }
        return nodes;
    }

    private static IEnumerable<JsonElement> Items(JsonElement list) =>
        list.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array ? items.EnumerateArray() : [];

    private static XElement ListItem(JsonElement item)
    {
        if (item.ValueKind == JsonValueKind.String)
        {
            return new XElement("li", Inline(item.GetString() ?? string.Empty));
        }
        if (Text(item, "type") is "item" or "itemSub" or "itemSpell")
        {
            return new XElement("li", ItemContent(item));
        }
        return new XElement("li", Entry(item));
    }

    // "Name. entry" on one line; further entries as their own paragraphs
    private static List<object> ItemContent(JsonElement item)
    {
        var content = new List<object>();
        if (Text(item, "name") is { } name)
        {
            content.Add(new XElement("strong", Inline(name.TrimEnd('.', ':') + ".")));
            content.Add(new XText(" "));
        }
        var parts = new List<JsonElement>();
        if (item.TryGetProperty("entry", out var entry))
        {
            parts.Add(entry);
        }
        if (item.TryGetProperty("entries", out var entries) && entries.ValueKind == JsonValueKind.Array)
        {
            parts.AddRange(entries.EnumerateArray());
        }
        for (var i = 0; i < parts.Count; i++)
        {
            if (i == 0 && parts[i].ValueKind == JsonValueKind.String)
            {
                content.AddRange(Inline(parts[i].GetString() ?? string.Empty));
            }
            else
            {
                content.AddRange(Entry(parts[i]));
            }
        }
        return content;
    }

    private static XElement? Table(JsonElement table)
    {
        if (!table.TryGetProperty("rows", out var rows) || rows.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var element = new XElement("table");
        if (Text(table, "caption") is { } caption)
        {
            element.Add(new XElement("caption", Inline(caption)));
        }
        if (table.TryGetProperty("colLabels", out var labels) && labels.ValueKind == JsonValueKind.Array)
        {
            element.Add(new XElement("thead", new XElement("tr", labels.EnumerateArray().Select(l => new XElement("th", Inline(l.ToString()))))));
        }
        var body = new XElement("tbody");
        foreach (var row in rows.EnumerateArray())
        {
            var cells = row.ValueKind == JsonValueKind.Object && row.TryGetProperty("row", out var r) ? r : row;
            if (cells.ValueKind == JsonValueKind.Array)
            {
                body.Add(new XElement("tr", cells.EnumerateArray().Select(Cell)));
            }
        }
        element.Add(body);
        return element;
    }

    private static XElement Cell(JsonElement cell)
    {
        if (cell.ValueKind == JsonValueKind.String)
        {
            return new XElement("td", Inline(cell.GetString() ?? string.Empty));
        }
        if (cell.ValueKind == JsonValueKind.Number)
        {
            return new XElement("td", cell.ToString());
        }
        if (cell.ValueKind == JsonValueKind.Object && cell.TryGetProperty("roll", out var roll))
        {
            if (roll.TryGetProperty("exact", out var exact))
            {
                return new XElement("td", exact.ToString());
            }
            var min = roll.TryGetProperty("min", out var mn) ? mn.ToString() : "";
            var max = roll.TryGetProperty("max", out var mx) ? mx.ToString() : "";
            return new XElement("td", $"{min}–{max}");
        }
        return new XElement("td", Entry(cell));
    }

    /// <summary>
    /// Inline text with {@tag …} references: bold/italic become strong/em, everything else its display text.
    /// </summary>
    public static List<XNode> Inline(string text)
    {
        var nodes = new List<XNode>();
        var plain = new StringBuilder();
        var i = 0;
        while (i < text.Length)
        {
            if (text[i] == '{' && i + 1 < text.Length && text[i + 1] == '@' && MatchingBrace(text, i) is var end && end > i)
            {
                if (plain.Length > 0)
                {
                    nodes.Add(new XText(plain.ToString()));
                    plain.Clear();
                }
                nodes.AddRange(Tag(text[(i + 2)..end]));
                i = end + 1;
                continue;
            }
            plain.Append(text[i]);
            i++;
        }
        if (plain.Length > 0)
        {
            nodes.Add(new XText(plain.ToString()));
        }
        return nodes;
    }

    /// <summary>Plain text of inline content, for short fields (titles, symbols).</summary>
    public static string PlainText(string text) => string.Concat(Inline(text).Select(n => n is XElement e ? e.Value : ((XText)n).Value));

    private static int MatchingBrace(string text, int start)
    {
        var depth = 0;
        for (var i = start; i < text.Length; i++)
        {
            if (text[i] == '{')
            {
                depth++;
            }
            else if (text[i] == '}' && --depth == 0)
            {
                return i;
            }
        }
        return -1;
    }

    private static IEnumerable<XNode> Tag(string body)
    {
        var space = body.IndexOf(' ');
        var tag = (space < 0 ? body : body[..space]).ToLowerInvariant();
        var content = space < 0 ? string.Empty : body[(space + 1)..];

        switch (tag)
        {
            case "b":
            case "bold":
                return [new XElement("strong", Inline(content))];
            case "i":
            case "italic":
            case "note":
                return [new XElement("em", Inline(content))];
            case "u":
            case "underline":
            case "s":
            case "strike":
            case "sup":
            case "sub":
            case "code":
                return Inline(content);
            case "h":
                return [new XElement("em", "Hit: ")];
            case "m":
                return [new XElement("em", "Miss: ")];
        }

        var parts = SplitTopLevel(content);
        var first = parts.Count > 0 ? parts[0] : string.Empty;
        var display = tag switch
        {
            "dc" => $"DC {first}",
            "hit" or "d20" => first.StartsWith('-') || first.StartsWith('+') ? first : $"+{first}",
            "chance" => parts.Count > 1 && parts[1].Length > 0 ? parts[1] : $"{first} percent",
            "recharge" => first.Length > 0 ? $"(Recharge {first}–6)" : "(Recharge 6)",
            "dice" or "damage" or "scaledice" or "scaledamage" => parts.Count > 2 && parts[2].Length > 0 ? parts[2] : first,
            // {@tag name|source|display}: the display text when given, else the name
            _ => parts.Count > 2 && parts[2].Length > 0 ? parts[2] : first,
        };
        return Inline(display);
    }

    // split on '|' outside nested {@…} tags
    private static List<string> SplitTopLevel(string content)
    {
        var parts = new List<string>();
        var depth = 0;
        var current = new StringBuilder();
        foreach (var c in content)
        {
            if (c == '{') depth++;
            if (c == '}') depth--;
            if (c == '|' && depth == 0)
            {
                parts.Add(current.ToString());
                current.Clear();
                continue;
            }
            current.Append(c);
        }
        parts.Add(current.ToString());
        return parts;
    }

    public static string? Text(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
