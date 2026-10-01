using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Starlights.Modules.Characters.Domain.Campaigns;

namespace Starlights.Modules.Characters.Data.EntityFramework.TypeConfiguration;

public class CampaignTypeConfiguration : IEntityTypeConfiguration<Campaign>
{
    public void Configure(EntityTypeBuilder<Campaign> builder)
    {
        builder.ToTable("campaign");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Description).HasColumnName("description").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.CoverUrl).HasColumnName("cover_url").HasMaxLength(500);
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.UpdatedAt).HasColumnName("updated_at");
        builder.Property(e => e.PasswordHash).HasColumnName("password_hash");

        // the party as a JSON list of character ids
        builder.Property<List<Guid>>("_party")
            .HasColumnName("party")
            .HasColumnType("nvarchar(max)")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<List<Guid>>(v, (JsonSerializerOptions?)null) ?? new List<Guid>(),
                new ValueComparer<List<Guid>>((a, b) => a!.SequenceEqual(b!), v => v.Aggregate(0, (h, g) => HashCode.Combine(h, g)), v => v.ToList()));
        builder.Ignore(e => e.Party);
    }
}

public class CampaignEntryTypeConfiguration : IEntityTypeConfiguration<CampaignEntry>
{
    public void Configure(EntityTypeBuilder<CampaignEntry> builder)
    {
        builder.ToTable("campaign_entry");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(e => e.CampaignId).HasColumnName("campaign_id");
        builder.HasOne<Campaign>().WithMany().HasForeignKey(e => e.CampaignId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(e => e.CampaignId);
        builder.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(32).IsRequired();
        builder.Property(e => e.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Number).HasColumnName("number");
        builder.Property(e => e.OccurredOn).HasColumnName("occurred_on").HasMaxLength(60);
        builder.Property(e => e.Visible).HasColumnName("visible");
        builder.Property(e => e.Body).HasColumnName("body").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.DmNotes).HasColumnName("dm_notes").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.ImageUrl).HasColumnName("image_url").HasMaxLength(500);
        builder.Property(e => e.Data).HasColumnName("data").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.Sort).HasColumnName("sort");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.UpdatedAt).HasColumnName("updated_at");
    }
}
