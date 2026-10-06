using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Data.EntityFramework.TypeConfiguration;

public class CharacterSnapshotTypeConfiguration : IEntityTypeConfiguration<CharacterSnapshot>
{
    public void Configure(EntityTypeBuilder<CharacterSnapshot> builder)
    {
        builder.ToTable("character_snapshot");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("character_id").ValueGeneratedNever();
        builder.Property(e => e.Data).HasColumnName("data").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.TakenAt).HasColumnName("taken_at");
    }
}
