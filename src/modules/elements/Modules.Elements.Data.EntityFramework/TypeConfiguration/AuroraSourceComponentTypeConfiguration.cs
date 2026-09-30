using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Starlights.Modules.Elements.Domain.Components;

namespace Starlights.Modules.Elements.Data.EntityFramework.TypeConfiguration;

public class AuroraSourceComponentTypeConfiguration : IEntityTypeConfiguration<AuroraSourceComponent>
{
    public void Configure(EntityTypeBuilder<AuroraSourceComponent> builder)
    {
        builder.ToTable("element_component_aurora_source");

        builder.Property(x => x.AuroraId)
            .IsRequired()
            .HasMaxLength(256)
            .HasColumnName("aurora_id");

        builder.HasIndex(x => x.AuroraId);

        builder.Property(x => x.AuroraType)
            .IsRequired()
            .HasMaxLength(128)
            .HasColumnName("aurora_type");

        builder.Property(x => x.Source)
            .HasMaxLength(256)
            .HasColumnName("source");

        builder.Property(x => x.File)
            .IsRequired()
            .HasColumnName("file");

        builder.Property(x => x.RawXml)
            .IsRequired()
            .HasColumnName("raw_xml");
    }
}
