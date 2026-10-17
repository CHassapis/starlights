using System.Transactions;
using System.Xml.Linq;

namespace Starlights.Modules.Elements.Integration;

/// <summary>Restore the source file and roll back database changes when a homebrew import fails.</summary>
public static class HomebrewFileChange
{
    // The caller holds the homebrew gate for the whole operation, including recovery.
    public static async Task<T> ApplyAsync<T>(string path, XDocument? document, Func<Task<T>> import)
    {
        var original = File.Exists(path) ? await File.ReadAllBytesAsync(path) : null;
        try
        {
            T result;
            using (var transaction = new TransactionScope(TransactionScopeOption.Required,
                new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted, Timeout = TransactionManager.MaximumTimeout },
                TransactionScopeAsyncFlowOption.Enabled))
            {
                if (document is null)
                    File.Delete(path);
                else
                    document.Save(path);
                result = await import();
                transaction.Complete();
            }
            return result;
        }
        catch
        {
            // Recovery must also run after cancellation and transaction commit failures.
            if (original is null)
                File.Delete(path);
            else
                await File.WriteAllBytesAsync(path, original);
            throw;
        }
    }
}
