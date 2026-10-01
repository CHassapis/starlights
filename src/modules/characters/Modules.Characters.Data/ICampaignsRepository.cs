using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Data;

public interface ICampaignsRepository : IRepository
{
    Task<List<Campaign>> GetCampaignsAsync();

    Task<Campaign?> GetCampaignAsync(Guid id);

    Task<List<CampaignEntry>> GetEntriesAsync(Guid campaignId);

    Task<CampaignEntry?> GetEntryAsync(Guid campaignId, Guid entryId);

    Task<int> CountEntriesAsync(Guid campaignId);

    void Add(Campaign campaign);

    void Add(CampaignEntry entry);

    /// <summary>Removes a campaign; its entries go with it.</summary>
    void Remove(Campaign campaign);

    void Remove(CampaignEntry entry);
}
