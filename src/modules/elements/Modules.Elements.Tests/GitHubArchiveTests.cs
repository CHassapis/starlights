using System.Formats.Tar;
using System.IO.Compression;
using AwesomeAssertions;
using Starlights.Modules.Elements.Services.Content;

namespace Starlights.Modules.Elements.Tests;

/// <summary>Content links the admin pastes, and unpacking what GitHub sends back.</summary>
[TestClass]
public class GitHubArchiveTests
{
    [TestMethod]
    [DataRow("https://github.com/AuroraLegacy/elements", "AuroraLegacy", "elements", null)]
    [DataRow("https://github.com/5etools-mirror-3/5etools-src.git", "5etools-mirror-3", "5etools-src", null)]
    [DataRow("https://github.com/me/elements/tree/my-branch/", "me", "elements", "my-branch")]
    [DataRow("  https://github.com/me/my.repo  ", "me", "my.repo", null)]
    public void Accepts_GitHubRepositoryLinks(string link, string owner, string name, string? branch) =>
        GitHubRepo.Parse(link).Should().Be(new GitHubRepo(owner, name, branch));

    [TestMethod]
    [DataRow("http://github.com/AuroraLegacy/elements")]
    [DataRow("https://gitlab.com/AuroraLegacy/elements")]
    [DataRow("https://github.com.evil.example/a/b")]
    [DataRow("https://github.com/a")]
    [DataRow("https://github.com/a/b/tree/../../x")]
    [DataRow("https://github.com/a/../b")]
    [DataRow("https://user@github.com/a/b")]
    [DataRow("file:///etc/passwd")]
    [DataRow("")]
    public void Refuses_AnythingElse(string link) => GitHubRepo.Parse(link).Should().BeNull();

    [TestMethod]
    public void BuildsTheAddressesItFetches()
    {
        var repo = GitHubRepo.Parse("https://github.com/AuroraLegacy/elements")!;
        repo.CommitUri.ToString().Should().Be("https://api.github.com/repos/AuroraLegacy/elements/commits/HEAD");
        repo.ArchiveUri("abc123").ToString().Should().Be("https://codeload.github.com/AuroraLegacy/elements/tar.gz/abc123");
    }

    private static MemoryStream Archive(params TarEntry[] entries)
    {
        var buffer = new MemoryStream();
        using (var gzip = new GZipStream(buffer, CompressionLevel.Fastest, leaveOpen: true))
        using (var writer = new TarWriter(gzip, TarEntryFormat.Pax, leaveOpen: true))
        {
            foreach (var e in entries)
            {
                writer.WriteEntry(e);
            }
        }
        buffer.Position = 0;
        return buffer;
    }

    private static PaxTarEntry File(string name, string text = "x") =>
        new(TarEntryType.RegularFile, name) { DataStream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(text)) };

    [TestMethod]
    public async Task Unpacks_WithoutTheTopFolder_OnlyWhatIsWanted()
    {
        var target = Path.Combine(Path.GetTempPath(), "gha-" + Guid.NewGuid().ToString("N"));
        try
        {
            var result = await GitHubArchive.ExtractAsync(
                Archive(new PaxTarEntry(TarEntryType.Directory, "repo-abc/"), File("repo-abc/package.json", "{}"), File("repo-abc/data/spells.json"), File("repo-abc/js/app.js")),
                target, p => p == "package.json" || p.StartsWith("data/", StringComparison.Ordinal), 1_000_000, 100);
            result.Files.Should().Be(2);
            System.IO.File.Exists(Path.Combine(target, "package.json")).Should().BeTrue();
            System.IO.File.Exists(Path.Combine(target, "data", "spells.json")).Should().BeTrue();
            System.IO.File.Exists(Path.Combine(target, "js", "app.js")).Should().BeFalse();
        }
        finally
        {
            Directory.Delete(target, recursive: true);
        }
    }

    [TestMethod]
    public async Task NeverWritesOutsideTheFolder_NorFollowsLinks()
    {
        var target = Path.Combine(Path.GetTempPath(), "gha-" + Guid.NewGuid().ToString("N"));
        try
        {
            var result = await GitHubArchive.ExtractAsync(
                Archive(File("repo/../../escape.txt"), File("repo/a/../../b.txt"), new PaxTarEntry(TarEntryType.SymbolicLink, "repo/link") { LinkName = "/etc/passwd" }, File("repo/ok.txt")),
                target, _ => true, 1_000_000, 100);
            result.Files.Should().Be(1);
            result.Skipped.Should().Be(3);
            Directory.GetFiles(target, "*", SearchOption.AllDirectories).Select(Path.GetFileName).Should().BeEquivalentTo(["ok.txt"]);
            System.IO.File.Exists(Path.Combine(Path.GetDirectoryName(target)!, "escape.txt")).Should().BeFalse();
        }
        finally
        {
            Directory.Delete(target, recursive: true);
        }
    }

    [TestMethod]
    public async Task StopsAtTheSizeLimit()
    {
        var target = Path.Combine(Path.GetTempPath(), "gha-" + Guid.NewGuid().ToString("N"));
        try
        {
            var act = () => GitHubArchive.ExtractAsync(Archive(File("repo/a.txt", new string('x', 600)), File("repo/b.txt", new string('x', 600))), target, _ => true, 1_000, 100);
            await act.Should().ThrowAsync<InvalidDataException>();
        }
        finally
        {
            Directory.Delete(target, recursive: true);
        }
    }
}
