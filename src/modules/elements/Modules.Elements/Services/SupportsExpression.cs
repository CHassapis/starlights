namespace Starlights.Modules.Elements.Services;

/// <summary>
/// Evaluates an Aurora-style supports expression, as used by selection rules, against an element.
/// <c>,</c> is AND, <c>|</c> or <c>||</c> is OR, <c>!</c> is NOT, parentheses group. A term matches when the
/// element lists it in its supports or it is the element's Aurora id, e.g. <c>Skill,PHB24 Fighter</c> or
/// <c>Maneuver,(Battle Master||PHB24 Battle Master)</c>.
/// </summary>
/// <remarks>
/// Terms that depend on character state the builder does not track yet — <c>$(spellcasting:list)</c> and
/// bare numbers (spell levels) — count as a match, so such selections are wider than in Aurora rather than empty.
/// </remarks>
internal sealed class SupportsExpression
{
    private readonly List<string> _tokens;
    private int _position;
    private Func<string, bool> _isMatch = _ => false;

    private SupportsExpression(List<string> tokens)
    {
        _tokens = tokens;
    }

    public static Func<IReadOnlyCollection<string>, string?, bool> Compile(string expression) => Compile(expression, numbersAreTerms: false);

    /// <summary>
    /// With <paramref name="numbersAreTerms"/>, a number is an ordinary term (a spell selection passes the spell's
    /// level among its supports) instead of matching everything.
    /// </summary>
    public static Func<IReadOnlyCollection<string>, string?, bool> Compile(string expression, bool numbersAreTerms)
    {
        var parser = new SupportsExpression(Tokenize(expression));
        return (supports, auroraId) =>
        {
            parser._position = 0;
            parser._isMatch = term =>
                term.StartsWith("$(", StringComparison.Ordinal) ||
                (!numbersAreTerms && int.TryParse(term, out _)) ||
                string.Equals(term, auroraId, StringComparison.Ordinal) ||
                supports.Contains(term, StringComparer.OrdinalIgnoreCase);
            return parser.ParseOr();
        };
    }

    /// <summary>
    /// Fills in a spell selection's placeholders: $(spellcasting:list) with the lists (A|B), $(spellcasting:slots)
    /// with the levels (1|2|3). A placeholder with nothing to fill in matches nothing.
    /// </summary>
    public static string FillSpellPlaceholders(string expression, IReadOnlyCollection<string> lists, IReadOnlyCollection<int> slotLevels)
    {
        static string Group(IEnumerable<string> terms) => terms.Any() ? $"({string.Join("|", terms)})" : "ID_NOTHING_MATCHES";
        return expression
            .Replace("$(spellcasting:list)", Group(lists), StringComparison.OrdinalIgnoreCase)
            .Replace("$(spellcasting:slots)", Group(slotLevels.Select(l => l.ToString(System.Globalization.CultureInfo.InvariantCulture))), StringComparison.OrdinalIgnoreCase);
    }

    private bool ParseOr()
    {
        var result = ParseAnd();
        while (Peek() == "|")
        {
            _position++;
            result |= ParseAnd(); // no short-circuit: the tokens still have to be consumed
        }
        return result;
    }

    private bool ParseAnd()
    {
        var result = ParseNot();
        while (Peek() == ",")
        {
            _position++;
            result &= ParseNot();
        }
        return result;
    }

    private bool ParseNot()
    {
        if (Peek() == "!")
        {
            _position++;
            return !ParseNot();
        }

        if (Peek() == "(")
        {
            _position++;
            var result = ParseOr();
            if (Peek() == ")")
            {
                _position++;
            }
            return result;
        }

        var term = _position < _tokens.Count ? _tokens[_position++] : string.Empty;
        return term.Length > 0 && _isMatch(term);
    }

    private string? Peek() => _position < _tokens.Count ? _tokens[_position] : null;

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

            // $(...) is a single term
            if (c == '$' && i + 1 < expression.Length && expression[i + 1] == '(')
            {
                var end = expression.IndexOf(')', i);
                end = end < 0 ? expression.Length - 1 : end;
                term.Append(expression, i, end - i + 1);
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
