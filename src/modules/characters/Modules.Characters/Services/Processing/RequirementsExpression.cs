namespace Starlights.Modules.Characters.Services.Processing;

/// <summary>
/// Evaluates a rule's requirements, as imported from Aurora with element ids in place of Aurora ids:
/// <c>,</c> is AND, <c>|</c> or <c>||</c> is OR, <c>!</c> is NOT, parentheses group. An element id term holds when
/// the character has that element registered; a bracket term <c>[name:N]</c> when that value is at least N:
/// <c>[level:5]</c> and <c>[character:5]</c> the character level, <c>[level:warlock:3]</c> a class level,
/// <c>[str:13]</c> an ability score, anything else a statistic (<c>[innate speed:fly:1]</c>).
/// Anything unknown (a value the character does not have, ids of elements that were not imported) does not hold,
/// so "!ID_SOMETHING_UNKNOWN" is met.
/// </summary>
internal static class RequirementsExpression
{
    public static bool Evaluate(string expression, Func<Guid, bool> hasElement, int characterLevel) =>
        Evaluate(expression, hasElement, name => name is "level" or "character" ? characterLevel : null);

    /// <param name="value">A bracket term's value by its lowercase Aurora name ("str", "level:warlock"); null when unknown.</param>
    public static bool Evaluate(string expression, Func<Guid, bool> hasElement, Func<string, int?> value)
    {
        var tokens = Tokenize(expression);
        var position = 0;

        string? Peek() => position < tokens.Count ? tokens[position] : null;

        bool Term(string term)
        {
            if (Guid.TryParse(term, out var elementId))
            {
                return hasElement(elementId);
            }

            if (term.StartsWith('[') && term.EndsWith(']'))
            {
                var inner = term[1..^1];
                var cut = inner.LastIndexOf(':');
                if (cut > 0 && int.TryParse(inner[(cut + 1)..].Trim(), out var least))
                {
                    return value(inner[..cut].Trim().ToLowerInvariant()) is { } actual && actual >= least;
                }
            }

            return false;
        }

        bool Or()
        {
            var result = And();
            while (Peek() == "|")
            {
                position++;
                result |= And();
            }
            return result;
        }

        bool And()
        {
            var result = Not();
            while (Peek() == ",")
            {
                position++;
                result &= Not();
            }
            return result;
        }

        bool Not()
        {
            if (Peek() == "!")
            {
                position++;
                return !Not();
            }

            if (Peek() == "(")
            {
                position++;
                var result = Or();
                if (Peek() == ")")
                {
                    position++;
                }
                return result;
            }

            var term = position < tokens.Count ? tokens[position++] : string.Empty;
            return term.Length > 0 && Term(term);
        }

        return Or();
    }

    private static List<string> Tokenize(string expression)
    {
        var tokens = new List<string>();
        var term = new System.Text.StringBuilder();

        void Flush()
        {
            var value = term.ToString().Trim();
            if (value.Length > 0)
            {
                tokens.Add(value);
            }
            term.Clear();
        }

        for (var i = 0; i < expression.Length; i++)
        {
            var c = expression[i];

            // [stat:value] is a single term (it may contain spaces)
            if (c == '[')
            {
                Flush();
                var end = expression.IndexOf(']', i);
                end = end < 0 ? expression.Length - 1 : end;
                tokens.Add(expression[i..(end + 1)]);
                i = end;
                continue;
            }

            switch (c)
            {
                case ',' or '!' or '(' or ')':
                    Flush();
                    tokens.Add(c.ToString());
                    break;
                case '|':
                    Flush();
                    if (tokens.Count == 0 || tokens[^1] != "|")
                    {
                        tokens.Add("|");
                    }
                    break;
                default:
                    term.Append(c);
                    break;
            }
        }

        Flush();
        return tokens;
    }
}
