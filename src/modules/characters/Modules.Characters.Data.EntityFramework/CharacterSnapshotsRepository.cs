using System.Data;
using System.Data.Common;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Components.Data.EntityFramework;

namespace Starlights.Modules.Characters.Data.EntityFramework;

/// <summary>
/// Captures a character's rows in every table it spans as one JSON document (FOR JSON), and puts them back (OPENJSON),
/// keeping their ids. The tables and how each finds the character's rows are listed here; their columns are read from
/// the database, so a new column is captured without changing this.
/// </summary>
internal class CharacterSnapshotsRepository : RepositoryBase<CharacterSnapshot>, ICharacterSnapshotsRepository
{
    // the character's own columns the builder changes (not its id, player or fight)
    private static readonly string[] CharacterColumns = ["name", "restricted_sources", "story", "extras", "inventory", "magic"];

    // table, and the condition on alias t that picks the character's rows (@id), in the order they are inserted
    private static readonly (string Table, string Where)[] Tables =
    [
        ("component_abilities", "t.parent_character = @id"),
        ("component_appearance", "t.parent_character = @id"),
        ("component_class", "t.parent_character = @id"),
        ("component_progression", "t.parent_character = @id"),
        ("component_saving_throws", "t.parent_character = @id"),
        ("component_skills", "t.parent_character = @id"),
        ("ability_scores", "t.parent_component_id IN (SELECT id FROM characters.component_abilities WHERE parent_character = @id)"),
        ("character_class", "t.parent_component_id IN (SELECT id FROM characters.component_class WHERE parent_character = @id)"),
        ("savingthrows", "t.parent_component_id IN (SELECT id FROM characters.component_saving_throws WHERE parent_character = @id)"),
        ("skills", "t.parent_component_id IN (SELECT id FROM characters.component_skills WHERE parent_character = @id)"),
        ("registration", "t.character_id = @id"),
        ("registration_include_rules", "t.parent_registration_id IN (SELECT id FROM characters.registration WHERE character_id = @id)"),
        ("registration_selection_rules", "t.parent_registration_id IN (SELECT id FROM characters.registration WHERE character_id = @id)"),
        ("registration_statistic_rules", "t.parent_registration_id IN (SELECT id FROM characters.registration WHERE character_id = @id)"),
    ];

    public Task<CharacterSnapshot?> GetAsync(Guid characterId) => Entities.SingleOrDefaultAsync(s => s.Id == characterId);

    public void Add(CharacterSnapshot snapshot) => Entities.Add(snapshot);

    public void Remove(CharacterSnapshot snapshot) => Entities.Remove(snapshot);

    public async Task<string> CaptureAsync(Guid characterId)
    {
        // (JSON_QUERY: a single object nests as JSON, not as a string)
        var sql = new StringBuilder("SELECT JSON_QUERY((SELECT ");
        sql.Append(string.Join(", ", CharacterColumns.Select(c => $"t.[{c}]")));
        sql.Append(" FROM characters.character t WHERE t.id = @id FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)) AS [character]");
        foreach (var (table, where) in Tables)
        {
            sql.Append($", (SELECT t.* FROM characters.[{table}] t WHERE {where} ORDER BY t.id FOR JSON PATH, INCLUDE_NULL_VALUES) AS [{table}]");
        }
        sql.Append(" FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER");

        var connection = Context.Database.GetDbConnection();
        await EnsureOpenAsync(connection);
        await using var command = connection.CreateCommand();
        command.Transaction = Context.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = sql.ToString();
        AddId(command, characterId);
        // FOR JSON comes back in chunks of rows
        var json = new StringBuilder();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            json.Append(reader.GetString(0));
        }
        return json.ToString();
    }

    public async Task RestoreAsync(Guid characterId, string data)
    {
        var connection = Context.Database.GetDbConnection();
        await EnsureOpenAsync(connection);
        var columns = await ColumnsAsync(connection);

        var sql = new StringBuilder();
        // what the character has now goes (the component and registration tables take their children with them)
        sql.AppendLine("DELETE FROM characters.registration WHERE character_id = @id;");
        foreach (var (table, _) in Tables.Where(t => t.Table.StartsWith("component_", StringComparison.Ordinal)))
        {
            sql.AppendLine($"DELETE FROM characters.[{table}] WHERE parent_character = @id;");
        }
        // the character's own columns as they were
        sql.Append("UPDATE c SET ").Append(string.Join(", ", CharacterColumns.Select(n => $"c.[{n}] = j.[{n}]")));
        sql.Append(" FROM characters.character c CROSS JOIN OPENJSON(@data, '$.character') WITH (");
        sql.Append(string.Join(", ", CharacterColumns.Select(n => $"[{n}] {columns["character"][n]} '$.{n}'")));
        sql.AppendLine(") j WHERE c.id = @id;");
        // and every row as it was, with the same ids
        foreach (var (table, _) in Tables)
        {
            var cols = columns[table];
            var names = string.Join(", ", cols.Keys.Select(n => $"[{n}]"));
            var with = string.Join(", ", cols.Select(c => $"[{c.Key}] {c.Value} '$.\"{c.Key}\"'"));
            sql.AppendLine($"INSERT INTO characters.[{table}] ({names}) SELECT {names} FROM OPENJSON(@data, '$.\"{table}\"') WITH ({with});");
        }

        var owned = Context.Database.CurrentTransaction is null;
        var transaction = owned ? await Context.Database.BeginTransactionAsync() : Context.Database.CurrentTransaction!;
        try
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = sql.ToString();
            AddId(command, characterId);
            var json = command.CreateParameter();
            json.ParameterName = "@data";
            json.DbType = DbType.String;
            json.Size = -1;
            json.Value = data;
            command.Parameters.Add(json);
            await command.ExecuteNonQueryAsync();
            if (owned)
            {
                await transaction.CommitAsync();
            }
        }
        catch
        {
            if (owned)
            {
                await transaction.RollbackAsync();
            }
            throw;
        }
        finally
        {
            if (owned)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    /// <summary>Each table's columns and their SQL types, for OPENJSON ... WITH.</summary>
    private async Task<Dictionary<string, Dictionary<string, string>>> ColumnsAsync(DbConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = Context.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
            FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'characters' ORDER BY TABLE_NAME, ORDINAL_POSITION
            """;
        var result = new Dictionary<string, Dictionary<string, string>>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var type = reader.GetString(2);
            var length = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3);
            var sqlType = type switch
            {
                "nvarchar" or "varchar" or "nchar" or "char" or "varbinary" or "binary" => $"{type}({(length is null or -1 ? "max" : length.ToString())})",
                "decimal" or "numeric" => $"{type}({reader.GetByte(4)},{reader.GetInt32(5)})",
                "datetime2" or "datetimeoffset" or "time" => $"{type}({reader.GetInt16(6)})",
                _ => type,
            };
            var table = reader.GetString(0);
            if (!result.TryGetValue(table, out var columns))
            {
                result[table] = columns = [];
            }
            columns[reader.GetString(1)] = sqlType;
        }
        return result;
    }

    private static async Task EnsureOpenAsync(DbConnection connection)
    {
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync();
        }
    }

    private static void AddId(DbCommand command, Guid characterId)
    {
        var id = command.CreateParameter();
        id.ParameterName = "@id";
        id.DbType = DbType.Guid;
        id.Value = characterId;
        command.Parameters.Add(id);
    }
}
