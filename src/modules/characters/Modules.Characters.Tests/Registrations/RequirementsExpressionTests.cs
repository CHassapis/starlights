using AwesomeAssertions;
using Starlights.Modules.Characters.Services.Processing;

namespace Starlights.Modules.Characters.Tests.Registrations;

[TestClass]
public class RequirementsExpressionTests
{
    private static readonly Guid BackgroundAsi = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Fighter = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Wizard = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static bool Evaluate(string expression, int level = 1, params Guid[] registered) =>
        RequirementsExpression.Evaluate(expression, registered.Contains, level);

    [TestMethod]
    public void NegatedElementHoldsUntilTheCharacterHasIt()
    {
        var unlessBackgroundAsi = $"!{BackgroundAsi}";

        Evaluate(unlessBackgroundAsi).Should().BeTrue();
        Evaluate(unlessBackgroundAsi, 1, BackgroundAsi).Should().BeFalse();
    }

    [TestMethod]
    [DataRow(false, false, false)]
    [DataRow(true, false, true)]
    [DataRow(false, true, true)]
    public void OrAndGroups(bool fighter, bool wizard, bool expected)
    {
        var registered = new List<Guid>();
        if (fighter) registered.Add(Fighter);
        if (wizard) registered.Add(Wizard);

        Evaluate($"({Fighter}||{Wizard}),!{BackgroundAsi}", 1, [.. registered]).Should().Be(expected);
    }

    [TestMethod]
    [DataRow(4, false)]
    [DataRow(5, true)]
    [DataRow(9, true)]
    public void LevelTerms(int level, bool expected)
    {
        Evaluate("[level:5]", level).Should().Be(expected);
    }

    [TestMethod]
    public void UnknownTermsDoNotHold()
    {
        Evaluate("ID_NOT_IMPORTED").Should().BeFalse();
        Evaluate("!ID_NOT_IMPORTED").Should().BeTrue();
        Evaluate("[innate speed:swim:1]").Should().BeFalse();
        Evaluate("!([str:15]||ID_NOT_IMPORTED)").Should().BeTrue();
    }

    [TestMethod]
    [DataRow(14, false)]
    [DataRow(13, false)]
    [DataRow(12, true)]
    public void HeavyArmorSlowsOnlyBelowItsStrength(int strength, bool slowed)
    {
        // Chain Mail: <stat name="innate speed" value="-10" requirements="!([str:13]||ID_…_IGNORE_STRENGTH_REQUIREMENT)" />
        var values = new Dictionary<string, int> { ["str"] = strength };
        RequirementsExpression.Evaluate("!([str:13]||ID_NOT_IMPORTED)", _ => false, n => values.TryGetValue(n, out var v) ? v : null).Should().Be(slowed);
    }

    [TestMethod]
    public void ValueTerms()
    {
        var values = new Dictionary<string, int> { ["level"] = 5, ["character"] = 5, ["level:warlock"] = 3, ["level:cleric"] = 0, ["innate speed:fly"] = 30, ["dex"] = 15 };
        bool Eval(string e) => RequirementsExpression.Evaluate(e, _ => false, n => values.TryGetValue(n, out var v) ? v : null);

        Eval("[character:5]").Should().BeTrue();
        Eval("[level:warlock:3]").Should().BeTrue();
        Eval("[level:warlock:4]").Should().BeFalse();
        Eval("[level:paladin:1]||[level:cleric:1]").Should().BeFalse();
        Eval("[innate speed:fly:1]").Should().BeTrue();
        Eval("[Dex:13],[level:5]").Should().BeTrue();
        Eval("[rune shaper:usage:2]").Should().BeFalse();
    }
}
