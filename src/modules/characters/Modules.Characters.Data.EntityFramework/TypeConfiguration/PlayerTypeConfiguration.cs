using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Starlights.Modules.Characters.Domain.Players;

namespace Starlights.Modules.Characters.Data.EntityFramework.TypeConfiguration;

public class PlayerTypeConfiguration : IEntityTypeConfiguration<Player>
{
    public void Configure(EntityTypeBuilder<Player> builder)
    {
        builder.ToTable("player");

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        // unique under the database's case-insensitive collation, like the name matching elsewhere
        builder.Property(e => e.Name)
            .HasColumnName("name")
            .HasMaxLength(64)
            .IsRequired();
        builder.HasIndex(e => e.Name).IsUnique();

        builder.Property(e => e.PasswordHash)
            .HasColumnName("password_hash");
    }
}
