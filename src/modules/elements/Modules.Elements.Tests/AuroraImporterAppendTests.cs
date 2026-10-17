using AwesomeAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using System.Transactions;
using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Modules.Elements.Services;
using Starlights.Modules.Elements.Services.FiveETools;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Tests;

[TestClass]
public class AuroraImporterAppendTests
{
    // the appends sort before the elements they add to, and a third file repeats them (a pull request copying a merged file)
    private const string Appends = """
        <elements>
          <append id="ID_TEST_SKILL"><supports>Artificer,ID_TEST_CLASS</supports></append>
          <append id="ID_TEST_FEATURE">
            <rules>
              <select type="Class Feature" name="Extra Plan" supports="Plan" level="9" />
              <grant type="Grants" id="ID_TEST_OTHER" />
            </rules>
          </append>
          <append id="ID_TEST_MISSING"><supports>Artificer</supports></append>
        </elements>
        """;

    private const string Elements = """
        <elements>
          <element name="Arcana" type="Proficiency" source="Test" id="ID_TEST_SKILL"><supports>Skill,Intelligence</supports></element>
          <element name="Replicate" type="Class Feature" source="Test" id="ID_TEST_FEATURE">
            <rules><select type="Class Feature" name="Plans" supports="Plan" number="4" /></rules>
          </element>
          <element name="Bag of Holding" type="Class Feature" source="Test" id="ID_TEST_PLAN">
            <supports>Plan</supports>
            <requirements>[level:artificer:6]</requirements>
            <prerequisites>Artificer Level 6+</prerequisites>
          </element>
          <element name="Other" type="Grants" source="Test" id="ID_TEST_OTHER" />
        </elements>
        """;

    private string _root = null!;

    [TestInitialize]
    public void Setup()
    {
        _root = Directory.CreateTempSubdirectory("aurora-append-tests").FullName;
        Directory.CreateDirectory(Path.Combine(_root, "content"));
        var homebrew = Directory.CreateDirectory(Path.Combine(_root, "homebrew")).FullName;
        File.WriteAllText(Path.Combine(homebrew, "a-appends.xml"), Appends);
        File.WriteAllText(Path.Combine(homebrew, "b-elements.xml"), Elements);
        File.WriteAllText(Path.Combine(homebrew, "c-repeated.xml"), Appends);
    }

    [TestCleanup]
    public void Cleanup() => Directory.Delete(_root, recursive: true);

    private async Task<Dictionary<string, Element>> ImportAsync()
    {
        var added = new List<Element>();
        var repository = new Mock<IElementsRepository>();
        repository.Setup(x => x.GetElementSummariesAsync()).ReturnsAsync([]);
        repository.Setup(x => x.Add(It.IsAny<Element>())).Callback<Element>(added.Add);
        var persistence = new Mock<IPersistence>();
        persistence.Setup(x => x.GetRepository<IElementsRepository>()).Returns(repository.Object);

        var importer = new AuroraImporter(
            NullLogger<AuroraImporter>.Instance,
            persistence.Object,
            new AuroraImporterOptions(Path.Combine(_root, "content"), HomebrewPath: Path.Combine(_root, "homebrew")),
            new FiveEToolsData(new FiveEToolsOptions(Path.Combine(_root, "no-5etools")), NullLogger<FiveEToolsData>.Instance));
        await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex);

        return added.ToDictionary(e => e.GetRequiredComponent<AuroraSourceComponent>().AuroraId);
    }

    [TestMethod]
    public async Task FailedRebuild_RollsBackTheEarlierSave()
    {
        var repository = new Mock<IElementsRepository>();
        repository.Setup(x => x.GetElementSummariesAsync()).ReturnsAsync([]);
        repository.Setup(x => x.GetAuroraXmlAsync()).ReturnsAsync(new Dictionary<Guid, string>());
        var persistence = new Mock<IPersistence>();
        persistence.Setup(x => x.GetRepository<IElementsRepository>()).Returns(repository.Object);
        var probe = new TransactionProbe();
        var saves = 0;
        persistence.Setup(x => x.SaveChangesAsync()).Returns(() =>
        {
            Transaction.Current.Should().NotBeNull();
            if (++saves == 1)
            {
                Transaction.Current!.EnlistVolatile(probe, EnlistmentOptions.None);
                return Task.FromResult(1);
            }
            throw new InvalidOperationException("synthetic rebuild save failure");
        });
        var importer = new AuroraImporter(NullLogger<AuroraImporter>.Instance, persistence.Object,
            new AuroraImporterOptions(Path.Combine(_root, "content"), HomebrewPath: Path.Combine(_root, "homebrew")),
            new FiveEToolsData(new FiveEToolsOptions(Path.Combine(_root, "no-5etools")), NullLogger<FiveEToolsData>.Instance));
        Func<Task> import = async () => await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true);
        await import.Should().ThrowAsync<InvalidOperationException>();
        saves.Should().Be(2);
        probe.RolledBack.Should().BeTrue();
        probe.Committed.Should().BeFalse();
    }

    [TestMethod]
    public async Task AppendedSupports_AreMergedOnce()
    {
        var elements = await ImportAsync();

        var skill = elements["ID_TEST_SKILL"];
        skill.GetRequiredComponent<SupportsComponent>().Supports.Should().Equal("Skill", "Intelligence", "Artificer", "ID_TEST_CLASS");
        skill.GetRequiredComponent<AuroraSourceComponent>().RawXml.Should().Contain("<supports>Skill,Intelligence,Artificer,ID_TEST_CLASS</supports>");
    }

    [TestMethod]
    public async Task AppendedRules_AreAddedOnce()
    {
        var elements = await ImportAsync();

        var feature = elements["ID_TEST_FEATURE"];
        feature.GetComponents<SelectionRuleComponent>().Select(s => (s.Name, s.LevelRequirement)).Should().Equal(("Plans", 0), ("Extra Plan", 9));
        feature.GetComponents<IncludeRuleComponent>().Should().ContainSingle();
    }

    [TestMethod]
    public async Task Prerequisites_AreKeptForEveryElement()
    {
        var elements = await ImportAsync();

        var plan = elements["ID_TEST_PLAN"].GetRequiredComponent<PrerequisitesComponent>();
        plan.Prerequisites.Should().Be("Artificer Level 6+");
        plan.Requirements.Should().Be("[level:artificer:6]");
        elements["ID_TEST_OTHER"].GetComponent<PrerequisitesComponent>().Should().BeNull();
    }

    [TestMethod]
    public async Task MergedXml_IsTheSameOnEveryRun()
    {
        var first = await ImportAsync();
        var second = await ImportAsync();

        second.Values.Select(e => e.GetRequiredComponent<AuroraSourceComponent>().RawXml)
            .Should().Equal(first.Values.Select(e => e.GetRequiredComponent<AuroraSourceComponent>().RawXml));
    }
    [TestMethod]
    [DataRow("Class")]
    [DataRow("Race")]
    [DataRow("Archetype")]
    [DataRow("Feat")]
    [DataRow("Spell")]
    [DataRow("Proficiency")]
    public async Task AppendOnlyFile_ChangesExistingElementOfSupportedType(string type)
    {
        File.WriteAllText(Path.Combine(_root, "content", "fixture.xml"),
            $"<elements><element id='ID_APPEND_FIXTURE' name='Append fixture' type='{type}' source='Test'><supports>Original</supports></element></elements>");
        File.WriteAllText(Path.Combine(_root, "homebrew", "fixture-patch.xml"),
            "<elements><append id='ID_APPEND_FIXTURE'><supports>AdditionalSupport</supports></append></elements>");
        var elements = await ImportAsync();
        elements["ID_APPEND_FIXTURE"].GetRequiredComponent<SupportsComponent>().Supports.Should().Equal("Original", "AdditionalSupport");
        elements["ID_APPEND_FIXTURE"].GetRequiredComponent<AuroraSourceComponent>().File.Should().Be("fixture.xml");
    }

    [TestMethod]
    public async Task FirstImport_AlsoIncludesAppendTargetsOutsideHomebrew()
    {
        File.Move(Path.Combine(_root, "homebrew", "b-elements.xml"), Path.Combine(_root, "content", "base.xml"));
        var elements = await ImportAsync();
        elements["ID_TEST_SKILL"].GetRequiredComponent<SupportsComponent>().Supports.Should().Contain("Artificer");
        elements["ID_TEST_FEATURE"].GetComponents<IncludeRuleComponent>().Should().ContainSingle();
    }

    [TestMethod]
    public async Task AppendOnlyUpload_RefreshesExternalTargets_AndRestoresThemAfterReplacementAndDeletion()
    {
        // Definitions live in installed content, not in the homebrew file being imported.
        File.Move(Path.Combine(_root, "homebrew", "b-elements.xml"), Path.Combine(_root, "content", "base.xml"));
        File.Delete(Path.Combine(_root, "homebrew", "c-repeated.xml"));
        var saved = new Dictionary<Guid, Element>();
        var repository = new Mock<IElementsRepository>();
        repository.Setup(x => x.GetElementSummariesAsync()).ReturnsAsync(() => saved.Values
            .Select(e => new ElementSummary(e.Id.Value, e.Name, e.Type, "Test")).ToList());
        repository.Setup(x => x.GetAuroraXmlAsync()).ReturnsAsync(() => saved.ToDictionary(p => p.Key,
            p => p.Value.GetRequiredComponent<AuroraSourceComponent>().RawXml));
        repository.Setup(x => x.Add(It.IsAny<Element>())).Callback<Element>(e => saved[e.Id.Value] = e);
        repository.Setup(x => x.DeleteElementAsync(It.IsAny<Guid>())).ReturnsAsync((Guid id) => saved.Remove(id));
        var persistence = new Mock<IPersistence>();
        persistence.Setup(x => x.GetRepository<IElementsRepository>()).Returns(repository.Object);
        var importer = new AuroraImporter(NullLogger<AuroraImporter>.Instance, persistence.Object,
            new AuroraImporterOptions(Path.Combine(_root, "content"), HomebrewPath: Path.Combine(_root, "homebrew")),
            new FiveEToolsData(new FiveEToolsOptions(Path.Combine(_root, "no-5etools")), NullLogger<FiveEToolsData>.Instance));
        Element Get(string id) => saved.Values.Single(e => e.GetRequiredComponent<AuroraSourceComponent>().AuroraId == id);

        // Start with an already imported base, exactly as on a tester's installed server.
        File.Delete(Path.Combine(_root, "homebrew", "a-appends.xml"));
        File.WriteAllText(Path.Combine(_root, "content", "base.index"), "<index><files><file name='base.xml'/></files></index>");
        await importer.ImportAsync("base.index");
        var originalId = Get("ID_TEST_SKILL").Id;
        File.WriteAllText(Path.Combine(_root, "homebrew", "a-appends.xml"), Appends);
        var first = await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true);
        first.ElementsReplaced.Should().Be(2);
        Get("ID_TEST_SKILL").Id.Should().Be(originalId);
        first.Warnings.Should().ContainSingle(w => w.Contains("ID_TEST_MISSING"));
        Get("ID_TEST_SKILL").GetRequiredComponent<SupportsComponent>().Supports.Should().Contain("Artificer");
        Get("ID_TEST_SKILL").GetRequiredComponent<AuroraSourceComponent>().File.Should().Be("base.xml");
        var skillId = Get("ID_TEST_SKILL").Id;
        (await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true)).ElementsReplaced.Should().Be(0);

        // Updating or replacing installed Aurora content must retain homebrew contributions and IDs.
        var untouchedId = Get("ID_TEST_PLAN").Id;
        var untouchedXml = Get("ID_TEST_PLAN").GetRequiredComponent<AuroraSourceComponent>().RawXml;
        File.WriteAllText(Path.Combine(_root, "content", "base.xml"), Elements.Replace("Skill,Intelligence", "Skill,Intelligence,Upstream"));
        await importer.ImportAsync("base.index", update: true);
        Get("ID_TEST_SKILL").Id.Should().Be(skillId);
        Get("ID_TEST_SKILL").GetRequiredComponent<SupportsComponent>().Supports.Should().Equal("Skill", "Intelligence", "Upstream", "Artificer", "ID_TEST_CLASS");
        await importer.ImportAsync("base.index", replace: true);
        Get("ID_TEST_SKILL").Id.Should().Be(skillId);
        Get("ID_TEST_FEATURE").GetComponents<IncludeRuleComponent>().Should().ContainSingle();
        Get("ID_TEST_PLAN").Id.Should().Be(untouchedId);
        Get("ID_TEST_PLAN").GetRequiredComponent<AuroraSourceComponent>().RawXml.Should().Be(untouchedXml);
        File.WriteAllText(Path.Combine(_root, "content", "base.xml"), Elements);
        await importer.ImportAsync("base.index", update: true);

        // A second patch must survive both replacement and deletion of the first.
        File.WriteAllText(Path.Combine(_root, "homebrew", "other.xml"),
            "<elements><append id='ID_TEST_SKILL'><supports>OtherPatch</supports></append></elements>");
        File.WriteAllText(Path.Combine(_root, "homebrew", "a-appends.xml"),
            "<elements><append id='ID_TEST_FEATURE'><supports>Replacement</supports></append></elements>");
        await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true);
        Get("ID_TEST_SKILL").Id.Should().Be(skillId);
        Get("ID_TEST_SKILL").GetRequiredComponent<SupportsComponent>().Supports.Should().Equal("Skill", "Intelligence", "OtherPatch");
        Get("ID_TEST_FEATURE").GetComponents<IncludeRuleComponent>().Should().BeEmpty();
        Get("ID_TEST_FEATURE").GetComponents<SelectionRuleComponent>().Should().ContainSingle();
        Get("ID_TEST_FEATURE").GetRequiredComponent<SupportsComponent>().Supports.Should().Contain("Replacement");

        File.Delete(Path.Combine(_root, "homebrew", "a-appends.xml"));
        await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true);
        Get("ID_TEST_FEATURE").GetComponent<SupportsComponent>().Should().BeNull();
        Get("ID_TEST_SKILL").GetRequiredComponent<SupportsComponent>().Supports.Should().Contain("OtherPatch");
        File.Delete(Path.Combine(_root, "homebrew", "other.xml"));
        await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true);
        Get("ID_TEST_SKILL").GetRequiredComponent<SupportsComponent>().Supports.Should().Equal("Skill", "Intelligence");
        (await importer.ImportAsync(AuroraImporterOptions.HomebrewIndex, update: true)).ElementsReplaced.Should().Be(0);
    }
}
