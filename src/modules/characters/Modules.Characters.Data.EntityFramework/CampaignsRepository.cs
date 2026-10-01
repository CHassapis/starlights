using Microsoft.EntityFrameworkCore;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Platform.Components.Data.EntityFramework;

namespace Starlights.Modules.Characters.Data.EntityFramework;

internal class CampaignsRepository : RepositoryBase<Campaign>, ICampaignsRepository
{
    private DbSet<CampaignEntry> Entries => Context.Set<CampaignEntry>();

    public Task<List<Campaign>> GetCampaignsAsync() => Entities.OrderBy(c => c.Name).ToListAsync();

    public Task<Campaign?> GetCampaignAsync(Guid id) => Entities.SingleOrDefaultAsync(c => c.Id == id);

    public Task<List<CampaignEntry>> GetEntriesAsync(Guid campaignId) =>
        Entries.Where(e => e.CampaignId == campaignId).OrderBy(e => e.Kind).ThenBy(e => e.Number).ThenBy(e => e.Sort).ThenBy(e => e.CreatedAt).ToListAsync();

    public Task<CampaignEntry?> GetEntryAsync(Guid campaignId, Guid entryId) =>
        Entries.SingleOrDefaultAsync(e => e.CampaignId == campaignId && e.Id == entryId);

    public Task<int> CountEntriesAsync(Guid campaignId) => Entries.CountAsync(e => e.CampaignId == campaignId);

    public void Add(Campaign campaign) => Entities.Add(campaign);

    public void Add(CampaignEntry entry) => Entries.Add(entry);

    public void Remove(Campaign campaign) => Entities.Remove(campaign);

    public void Remove(CampaignEntry entry) => Entries.Remove(entry);
}
