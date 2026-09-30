namespace Starlights.Modules.Characters.Services.Processing;

/// <summary>
/// Evaluates a rule's requirements, as imported from Aurora with element ids in place of Aurora ids:
/// <c>,</c> is AND, <c>|</c> or <c>||</c> is OR, <c>!</c> is NOT, parentheses group. An element id term holds when
/// the character has that element registered; <c>[level:5]</c> when the character is at least that level.
/// Anything else (other bracket terms, ids of elements that were not imported) does not hold, so
/// "!ID_SOMETHING_UNKNOWN" is met.
/// </summary>
internal static class RequirementsExpression
{
    public static bool Evaluate(string expression, Func<Guid, bool> hasElement, int characterLevel)
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
                var parts = term[1..^1].Split(':');
                if (parts.Length == 2 && parts[0].Trim().Equals("level", StringComparison.OrdinalIgnoreCase) && int.TryParse(parts[1], out var level))
                {
                    return characterLevel >= level;
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
