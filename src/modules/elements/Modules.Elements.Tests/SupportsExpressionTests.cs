using AwesomeAssertions;
using Starlights.Modules.Elements.Services;

namespace Starlights.Modules.Elements.Tests;

[TestClass]
public class SupportsExpressionTests
{
    private static readonly string[] Athletics = ["Skill", "Strength", "PHB24 Fighter", "PHB24 Rogue"];

    [TestMethod]
    [DataRow("Skill", true)]
    [DataRow("skill", true)]
    [DataRow("Tool", false)]
    [DataRow("Skill,PHB24 Fighter", true)]
    [DataRow("Skill, PHB24 Wizard", false)]
    [DataRow("Skill||Tool", true)]
    [DataRow("Tool|Skill", true)]
    [DataRow("!Tool", true)]
    [DataRow("Skill,!Strength", false)]
    [DataRow("Tool,(Skill||Strength)", false)]
    [DataRow("Skill,(Tool||PHB24 Rogue)", true)]
    [DataRow("ID_OTHER|ID_PROFICIENCY_SKILL_ATHLETICS", true)]
    [DataRow("ID_OTHER|ID_ANOTHER", false)]
    public void MatchesSupportsAndIds(string expression, bool expected)
    {
        var matches = SupportsExpression.Compile(expression);

        matches(Athletics, "ID_PROFICIENCY_SKILL_ATHLETICS").Should().Be(expected);
    }

    [TestMethod]
    [DataRow("$(spellcasting:list), $(spellcasting:slots)")]
    [DataRow("Skill, 0")]
    public void UnsupportedDynamicTermsMatch(string expression)
    {
        var matches = SupportsExpression.Compile(expression);

        matches(Athletics, null).Should().BeTrue();
    }

    [TestMethod]
    public void CompiledExpressionCanBeReused()
    {
        var matches = SupportsExpression.Compile("Skill,PHB24 Fighter");

        matches(Athletics, null).Should().BeTrue();
        matches(["Skill", "PHB24 Wizard"], null).Should().BeFalse();
        matches(Athletics, null).Should().BeTrue();
    }
}
