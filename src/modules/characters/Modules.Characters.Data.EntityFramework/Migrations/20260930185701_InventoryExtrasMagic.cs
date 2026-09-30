using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Starlights.Modules.Characters.Data.EntityFramework.Migrations
{
    /// <inheritdoc />
    public partial class InventoryExtrasMagic : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "extras",
                schema: "characters",
                table: "character",
                type: "nvarchar(max)",
                nullable: false,
                defaultValueSql: "N'[]'");

            migrationBuilder.AddColumn<string>(
                name: "inventory",
                schema: "characters",
                table: "character",
                type: "nvarchar(max)",
                nullable: false,
                defaultValueSql: "N'{}'");

            migrationBuilder.AddColumn<string>(
                name: "magic",
                schema: "characters",
                table: "character",
                type: "nvarchar(max)",
                nullable: false,
                defaultValueSql: "N'{}'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "extras",
                schema: "characters",
                table: "character");

            migrationBuilder.DropColumn(
                name: "inventory",
                schema: "characters",
                table: "character");

            migrationBuilder.DropColumn(
                name: "magic",
                schema: "characters",
                table: "character");
        }
    }
}
