using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Starlights.Modules.Characters.Data.EntityFramework.Migrations
{
    /// <inheritdoc />
    public partial class Players : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "player",
                schema: "characters",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    name = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    password_hash = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_player_name",
                schema: "characters",
                table: "player",
                column: "name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "player",
                schema: "characters");
        }
    }
}
