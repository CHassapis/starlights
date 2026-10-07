using AwesomeAssertions;
using Starlights.Modules.Elements.Services.Content;

namespace Starlights.Modules.Elements.Tests;

/// <summary>What content is here (a git checkout, a 5etools changelog) and what GitHub says is newer, for the Content page.</summary>
[TestClass]
public class ContentVersionsTests
{
    private const string Old = "1111111111111111111111111111111111111111";
    private const string New = "c28ce6cd77ff92f7e0c99c5617a76cbe8371e35d";

    private static string Folder()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"content-versions-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        return folder;
    }

    [TestMethod]
    public void ReadsACheckout_ItsCommit_WhenItLastMoved_AndWhenItWasLastFetched()
    {
        var folder = Folder();
        var git = Path.Combine(folder, ".git");
        Directory.CreateDirectory(Path.Combine(git, "refs", "heads"));
        Directory.CreateDirectory(Path.Combine(git, "logs"));
        File.WriteAllText(Path.Combine(git, "HEAD"), "ref: refs/heads/master\n");
        File.WriteAllText(Path.Combine(git, "refs", "heads", "master"), New + "\n");
        File.WriteAllLines(Path.Combine(git, "logs", "HEAD"),
        [
            $"0000000000000000000000000000000000000000 {Old} Someone <someone@example.com> 1790000000 +0300\tclone: from https://github.com/AuroraLegacy/elements.git",
            $"{Old} {New} Someone <someone@example.com> 1790752184 +0300\tpull --ff-only: Fast-forward",
        ]);
        File.WriteAllText(Path.Combine(git, "FETCH_HEAD"), "");

        var state = ContentVersions.ReadCheckout(folder);

        state.Should().NotBeNull();
        state!.Commit.Should().Be(New);
        state.Branch.Should().Be("master");
        state.ChangedAt.Should().Be(DateTimeOffset.FromUnixTimeSeconds(1790752184));
        state.FetchedAt.Should().NotBeNull();
        Directory.Delete(folder, recursive: true);
    }

    [TestMethod]
    public void ReadsABranchFromPackedRefs_AndKnowsWhatIsNotACheckout()
    {
        var folder = Folder();
        var git = Path.Combine(folder, ".git");
        Directory.CreateDirectory(git);
        File.WriteAllText(Path.Combine(git, "HEAD"), "ref: refs/heads/main\n");
        File.WriteAllText(Path.Combine(git, "packed-refs"), $"# pack-refs with: peeled fully-peeled sorted\n{Old} refs/heads/other\n{New} refs/heads/main\n");

        ContentVersions.ReadCheckout(folder)!.Commit.Should().Be(New);
        ContentVersions.ReadCheckout(folder)!.ChangedAt.Should().BeNull();
        ContentVersions.ReadCheckout(Path.Combine(folder, ".git")).Should().BeNull();
        File.WriteAllText(Path.Combine(git, "HEAD"), "ref: refs/heads/../../escape\n");
        ContentVersions.ReadCheckout(folder)!.Commit.Should().BeNull();
        Directory.Delete(folder, recursive: true);
    }

    [TestMethod]
    public void ReadsThe5eToolsRelease_TheNewestInItsChangelog()
    {
        var folder = Folder();
        File.WriteAllText(Path.Combine(folder, "changelog.json"), """
            [{"ver":"2.9.0","date":"2025-01-02","txt":"-"},{"ver":"2.36.1","date":"2026-09-23","txt":"-"},{"ver":"2.10.4","date":"2025-03-01","txt":"-"}]
            """);

        ContentVersions.ReadFiveEToolsRelease(folder).Should().Be(new FiveEToolsRelease("2.36.1", "2026-09-23"));
        ContentVersions.ReadFiveEToolsRelease(Path.Combine(folder, "nowhere")).Should().BeNull();
        File.WriteAllText(Path.Combine(folder, "changelog.json"), "not json");
        ContentVersions.ReadFiveEToolsRelease(folder).Should().BeNull();
        Directory.Delete(folder, recursive: true);
    }

    [TestMethod]
    [DataRow("v2.37.0", "2.36.1", 1)]
    [DataRow("2.36.1", "v2.36.1", 0)]
    [DataRow("2.36.1", "2.36.10", -1)]
    [DataRow("v3.0", "2.99.99", 1)]
    public void ComparesVersions(string a, string b, int sign) => Math.Sign(ContentVersions.CompareVersions(a, b)).Should().Be(sign);

    [TestMethod]
    public void ReadsGitHubsCompare_NewestCommitFirst()
    {
        var json = """
            {"status":"ahead","ahead_by":2,
             "base_commit":{"sha":"OLD","commit":{"message":"Old","committer":{"date":"2026-09-19T15:20:32Z"}}},
             "commits":[
               {"sha":"2222222222222222222222222222222222222222","commit":{"message":"Add a feat\n\nlonger text","committer":{"date":"2026-10-01T10:00:00Z"}}},
               {"sha":"NEW","commit":{"message":"Fix a spell","committer":{"date":"2026-10-03T10:00:00Z"}}}],
             "files":[{"filename":"core/feats.xml","status":"modified"},{"filename":"core/spells.xml","status":"modified"}]}
            """.Replace("OLD", Old).Replace("NEW", New);

        var compare = ContentVersions.ParseCompare(json);

        compare.Status.Should().Be("ahead");
        compare.AheadBy.Should().Be(2);
        compare.Commits.Select(c => c.Message).Should().Equal("Fix a spell", "Add a feat");
        compare.Commits[0].Id.Should().Be("c28ce6c");
        compare.Files.Should().Equal("core/feats.xml", "core/spells.xml");
        compare.FilesChanged.Should().Be(2);
        compare.BaseDate.Should().Be(DateTimeOffset.Parse("2026-09-19T15:20:32Z"));
        compare.HeadDate.Should().Be(DateTimeOffset.Parse("2026-10-03T10:00:00Z"));
        ContentVersions.ParseCompare("""{"status":"identical","ahead_by":0,"commits":[],"files":[]}""").Commits.Should().BeEmpty();
    }

    [TestMethod]
    public void ReadsGitHubsLatestRelease()
    {
        var release = ContentVersions.ParseRelease("""{"tag_name":"v2.37.0","name":"v2.37.0","published_at":"2026-10-05T12:00:00Z","body":"- Added things\n- Fixed others"}""");

        release.Should().NotBeNull();
        release!.Tag.Should().Be("v2.37.0");
        release.PublishedAt.Should().Be(DateTimeOffset.Parse("2026-10-05T12:00:00Z"));
        release.Notes.Should().Contain("Fixed others");
        ContentVersions.ParseRelease("""{"message":"Not Found"}""").Should().BeNull();
    }
}
