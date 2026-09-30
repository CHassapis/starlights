using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Data.EntityFramework.TypeConfiguration;

public class CharacterTypeConfiguration : IEntityTypeConfiguration<Character>
{
    public void Configure(EntityTypeBuilder<Character> builder)
    {
        builder.ToTable("character");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id)
            .HasColumnName("id")
            .ValueGeneratedNever()
            .HasConversion(m => m.Value, v => new CharacterId(v));

        builder.Property(e => e.Name)
            .HasColumnName("name")
            .IsRequired();

        builder.Property(e => e.PlayerName)
            .HasColumnName("player_name")
            .HasMaxLength(64)
            .HasDefaultValue(string.Empty)
            .IsRequired();

        builder.HasIndex(e => e.PlayerName);

        builder.Property<List<string>>("_restrictedSources")
            .HasColumnName("restricted_sources")
            .HasColumnType("nvarchar(max)")
            .HasDefaultValue(new List<string>())
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new List<string>(),
                new ValueComparer<List<string>>((a, b) => a!.SequenceEqual(b!), v => v.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())), v => v.ToList()));
        builder.Ignore(e => e.RestrictedSources);

        builder.HasMany(x => x.Components)
            .WithOne()
            .HasForeignKey(x => x.ParentCharacter)
            .OnDelete(DeleteBehavior.Cascade)
            .IsRequired(false);
    }
}
