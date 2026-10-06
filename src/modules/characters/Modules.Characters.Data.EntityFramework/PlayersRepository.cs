using Microsoft.EntityFrameworkCore;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Players;
using Starlights.Platform.Components.Data.EntityFramework;

namespace Starlights.Modules.Characters.Data.EntityFramework;

internal class PlayersRepository : RepositoryBase<Player>, IPlayersRepository
{
    public void Add(Player player) => Entities.Add(player);

    // the column collation is case-insensitive, so this matches "cara vale" to "Cara Vale"
    public Task<Player?> GetPlayerAsync(string name) =>
        Entities.SingleOrDefaultAsync(p => p.Name == name.Trim());

    public Task<List<string>> GetLockedPlayerNamesAsync() =>
        Entities.AsNoTracking().Where(p => p.PasswordHash != null).Select(p => p.Name).ToListAsync();

    public Task<string?> GetCharacterPlayerNameAsync(Guid characterId) =>
        Context.Set<Character>().AsNoTracking()
            .Where(c => c.Id == new CharacterId(characterId))
            .Select(c => c.PlayerName)
            .FirstOrDefaultAsync();
}
