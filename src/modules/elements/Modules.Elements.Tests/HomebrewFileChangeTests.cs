using System.Transactions;
using System.Xml.Linq;
using AwesomeAssertions;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Elements.Tests;

[TestClass]
public class HomebrewFileChangeTests
{
    [TestMethod]
    public async Task FailedCommit_RestoresFile()
    {
        var folder = Directory.CreateTempSubdirectory("homebrew-commit-tests").FullName;
        var path = Path.Combine(folder, "patch.xml");
        const string original = "<elements><append id='ORIGINAL'/></elements>";
        try
        {
            await File.WriteAllTextAsync(path, original);
            Func<Task> change = async () => await HomebrewFileChange.ApplyAsync(path, null, () =>
            {
                Transaction.Current!.EnlistVolatile(new TransactionProbe { RejectCommit = true }, EnlistmentOptions.None);
                return Task.FromResult(1);
            });
            await change.Should().ThrowAsync<TransactionAbortedException>();
            (await File.ReadAllTextAsync(path)).Should().Be(original);
        }
        finally { Directory.Delete(folder, recursive: true); }
    }

    [TestMethod]
    public async Task CancelledImport_RestoresFile()
    {
        var folder = Directory.CreateTempSubdirectory("homebrew-cancel-tests").FullName;
        var path = Path.Combine(folder, "patch.xml");
        const string original = "<elements><append id='ORIGINAL'/></elements>";
        try
        {
            await File.WriteAllTextAsync(path, original);
            Func<Task> change = async () => await HomebrewFileChange.ApplyAsync<int>(path, null,
                () => Task.FromCanceled<int>(new CancellationToken(true)));
            await change.Should().ThrowAsync<OperationCanceledException>();
            (await File.ReadAllTextAsync(path)).Should().Be(original);
        }
        finally { Directory.Delete(folder, recursive: true); }
    }

    [TestMethod]
    [DataRow("create", false)]
    [DataRow("replace", false)]
    [DataRow("delete", false)]
    [DataRow("create", true)]
    [DataRow("replace", true)]
    [DataRow("delete", true)]
    public async Task FileAndDatabase_CommitOrRecoverTogether(string operation, bool fail)
    {
        var folder = Directory.CreateTempSubdirectory("homebrew-change-tests").FullName;
        var path = Path.Combine(folder, "patch.xml");
        var original = "<elements>\r\n  <append id='ORIGINAL'/>\r\n</elements>"u8.ToArray();
        var probe = new TransactionProbe();
        try
        {
            if (operation != "create") await File.WriteAllBytesAsync(path, original);
            var replacement = operation == "delete" ? null : XDocument.Parse("<elements><append id='NEW'/></elements>");
            Func<Task> change = async () => await HomebrewFileChange.ApplyAsync(path, replacement, async () =>
            {
                Transaction.Current.Should().NotBeNull();
                Transaction.Current!.EnlistVolatile(probe, EnlistmentOptions.None);
                await Task.Yield();
                File.Exists(path).Should().Be(operation != "delete");
                if (operation != "delete") XDocument.Load(path).Descendants("append").Single().Attribute("id")!.Value.Should().Be("NEW");
                if (fail) throw new InvalidOperationException("synthetic import failure");
                return 1;
            });
            if (fail)
            {
                await change.Should().ThrowAsync<InvalidOperationException>();
                probe.RolledBack.Should().BeTrue();
                probe.Committed.Should().BeFalse();
                File.Exists(path).Should().Be(operation != "create");
                if (operation != "create") (await File.ReadAllBytesAsync(path)).Should().Equal(original);
            }
            else
            {
                await change();
                probe.Committed.Should().BeTrue();
                probe.RolledBack.Should().BeFalse();
                File.Exists(path).Should().Be(operation != "delete");
            }
        }
        finally { Directory.Delete(folder, recursive: true); }
    }
}

internal sealed class TransactionProbe : IEnlistmentNotification
{
    public bool RejectCommit { get; init; }
    public bool Committed { get; private set; }
    public bool RolledBack { get; private set; }
    public void Prepare(PreparingEnlistment enlistment)
    {
        if (RejectCommit) enlistment.ForceRollback();
        else enlistment.Prepared();
    }
    public void Commit(Enlistment enlistment) { Committed = true; enlistment.Done(); }
    public void Rollback(Enlistment enlistment) { RolledBack = true; enlistment.Done(); }
    public void InDoubt(Enlistment enlistment) => enlistment.Done();
}
