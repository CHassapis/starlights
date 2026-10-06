using Microsoft.EntityFrameworkCore;
using Starlights.Modules.Characters.Data.EntityFramework.Querying;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Components.Data.EntityFramework;

namespace Starlights.Modules.Characters.Data.EntityFramework;

internal class CharactersRepository : RepositoryBase<Character>, ICharactersRepository
{
    public void Add(Character character) => Entities.Add(character);

    public Task<bool> DeleteCharacterAsync(CharacterId identifier)
    {
        var toRemove = Entities.SingleOrDefault(c => c.Id == identifier);
        if (toRemove is null)
        {
            return Task.FromResult(false);
        }

        Entities.Remove(toRemove);
        return Task.FromResult(true);
    }

    public async Task<Dictionary<Guid, CharacterCombatState>> GetCombatStatesAsync(IReadOnlyCollection<Guid> characterIds)
    {
        if (characterIds.Count == 0)
        {
            return [];
        }
        var keys = characterIds.Select(id => new CharacterId(id)).ToList();
        var rows = await Entities.AsNoTracking()
            .Where(c => keys.Contains(c.Id))
            .Select(c => new { c.Id, c.Name, Combat = EF.Property<CharacterCombat>(c, "_combat") })
            .ToListAsync();
        return rows.ToDictionary(r => r.Id.Value, r => new CharacterCombatState(r.Id.Value, r.Name, r.Combat ?? new CharacterCombat()));
    }

    public async Task<Character?> GetCharacterAsync(Guid identifier)
    {
        return await Entities
            .IncludeAggregateGraph()
            .AsSplitQuery()
            .SingleOrDefaultAsync(a => a.Id == identifier);
    }

    public async Task<IEnumerable<Character>> GetCharactersAsync()
    {
        return await Entities
            .IncludeAggregateGraph()
            .AsSplitQuery()
            .ToListAsync();
    }
}
