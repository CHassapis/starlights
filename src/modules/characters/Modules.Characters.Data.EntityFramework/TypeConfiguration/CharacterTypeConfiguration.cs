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

        builder.Property<Dictionary<string, string>>("_story")
            .HasColumnName("story")
            .HasColumnType("nvarchar(max)")
            .HasDefaultValue(new Dictionary<string, string>())
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, (JsonSerializerOptions?)null) ?? new Dictionary<string, string>(),
                new ValueComparer<Dictionary<string, string>>(
                    (a, b) => a!.Count == b!.Count && !a.Except(b).Any(),
                    v => v.Aggregate(0, (h, kv) => HashCode.Combine(h, kv.Key.GetHashCode(), kv.Value.GetHashCode())),
                    v => new Dictionary<string, string>(v)));
        builder.Ignore(e => e.Story);

        // inventory, extras and magic are JSON documents; a missing property reads as its default, so their shape
        // can grow without migrations (each carries a version for when it has to change)
        JsonColumn<CharacterInventory>(builder, "_inventory", "inventory", "{}", () => new CharacterInventory());
        builder.Ignore(e => e.Inventory);
        JsonColumn<List<CharacterExtra>>(builder, "_extras", "extras", "[]", () => []);
        builder.Ignore(e => e.Extras);
        JsonColumn<CharacterMagic>(builder, "_magic", "magic", "{}", () => new CharacterMagic());
        builder.Ignore(e => e.Magic);

        builder.HasMany(x => x.Components)
            .WithOne()
            .HasForeignKey(x => x.ParentCharacter)
            .OnDelete(DeleteBehavior.Cascade)
            .IsRequired(false);
    }

    private static void JsonColumn<T>(EntityTypeBuilder<Character> builder, string field, string column, string defaultJson, Func<T> empty)
        where T : class
    {
        builder.Property<T>(field)
            .HasColumnName(column)
            .HasColumnType("nvarchar(max)")
            .HasDefaultValueSql($"N'{defaultJson}'")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<T>(v, (JsonSerializerOptions?)null) ?? empty(),
                new ValueComparer<T>(
                    (a, b) => JsonSerializer.Serialize(a, (JsonSerializerOptions?)null) == JsonSerializer.Serialize(b, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null).GetHashCode(),
                    v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, (JsonSerializerOptions?)null), (JsonSerializerOptions?)null)!));
    }
}
