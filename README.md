# Project Starlights

> **About this fork (branch `aurora-server`).** A self-hosted build of Project Starlights by C Hassapis, packaged to
> run in Docker for a D&D group. All credit for Starlights and Aurora Builder goes to their creator, **Bas Driessen**
> ([swdriessen/starlights](https://github.com/swdriessen/starlights), [aurorabuilder.com](https://www.aurorabuilder.com)).
> The content comes from [Aurora Legacy](https://github.com/AuroraLegacy/elements) and the Compendium's data from
> [5etools](https://github.com/5etools-mirror-3/5etools-src). Unofficial fan project, not affiliated with or endorsed by
> Wizards of the Coast; no book content is part of this repository. The original README follows the fork's sections.

## What this fork adds

- **Docker install** for one machine: `deploy/setup.sh` fetches the content and sets everything up (see below).
- **Character wizard** for new players: class, species, background, ability scores, the books' starting equipment
  (packages or gold) and spells, one step at a time, with a skip to the full builder.
- **Character sheets like Aurora's**, on screen and as PDF; bring in players' Aurora character files.
- **Builder**: multiclassing, 2014 and 2024 rules (or both), Save / Discard, items that cast spells, extra feats,
  languages and proficiencies.
- **Battle Action Simulator**: attacks, spells, slots and charges, magic items (wands, staffs), familiars, conditions;
  prepare spells right there, and cast one the player forgot to prepare (the DM's call).
- **Campaigns** with a DM's side: sessions, NPCs, places, quests, maps, handouts, magic items to hand out, notes, and a
  Gold tab with the party fund and stash. The Magic items tab shows who carries each item. Players only see what the
  DM reveals.
- **Encounters run as fights**: initiative, turns, monster hit points (hidden from players), and the party's hit points
  and conditions straight from their simulators.
- **Trading**: players give each other items and coins from their Equipment tab.
- **Homebrew page**: make magic items (weapons can have their own damage dice) and monsters in a form, or upload Aurora element files. Homebrew is off by
  default: a player ticks it in a character's Sources, and a DM switches on "Use homebrew" in a campaign's settings.
- **Compendium of Lore**: the books, creatures, spells and items from the 5etools data, linkable from campaigns.
- Player names instead of accounts, with optional passwords; an admin password for the DM.

## Install with Docker

You need a Linux machine (or WSL) with Docker and the compose plugin, `git`, `curl` and `openssl`, and about 3 GB of
disk. Then:

```bash
git clone -b aurora-server https://github.com/CHassapis/starlights.git
cd starlights/deploy
./setup.sh
```

`setup.sh` takes a while the first time. It:

1. writes `deploy/.env` with random passwords (your **admin password** is `STARLIGHTS_MASTER_PASSWORD` in it);
2. clones the content into `deploy/data`: Aurora Legacy's elements and the 5etools data;
3. builds and starts the database, the API and the web app;
4. imports the content (about 14,000 elements) and builds the Compendium of Lore.

Then open `http://<your machine>:8093`, pick a player name, and make a character. Use the key button in the header with
the admin password to act as the DM and to make homebrew. Change the port with `STARLIGHTS_PORT` in `.env`.

Keep the site on your own network (or behind a VPN such as Tailscale). The book content it serves is for your table's
private use; don't put it on the open internet.

### How Aurora Legacy and 5etools are connected

| Content | Where it lives | Used for |
|---|---|---|
| [AuroraLegacy/elements](https://github.com/AuroraLegacy/elements) | `deploy/data/aurora-elements` | classes, species, backgrounds, feats, spells, items: the builder's rules |
| [5etools-src](https://github.com/5etools-mirror-3/5etools-src) | `deploy/data/5etools-src` | the Compendium of Lore, deities Aurora lacks, creatures for encounters |
| Your homebrew | `deploy/data/homebrew` | made on the Homebrew page |

Both are plain git clones, so you can point them at your own fork. Optional extras:

- **Aurora's PDF sheets**: if you own Aurora Builder, copy the sheet templates and fonts from its install folder into
  `deploy/data/aurora-sheets` for PDF sheets laid out like Aurora's. Without them the on-screen sheet still works.
- **Background pictures**: put `home-1.webp` … `home-5.webp`, `lore.webp` and `battle.webp` in `deploy/data/art`.

### Updating

```bash
cd starlights && git pull                                # new code
cd deploy && docker compose build && docker compose up -d
./admin.sh update                                        # newest Aurora Legacy and 5etools content
```

`./admin.sh` also has `import`, `reprocess` (after an import, so characters get new choices) and `lore`. Run it without
arguments for help. Back up `deploy/data` (the database is in `deploy/data/mssql`).

## The original README

This is a work-in-progress project intended as an online toolset to enhance tabletop role‑playing games. Its initial focus is creating characters for Dungeons & Dragons in the form of an online version of [Aurora](https://www.aurorabuilder.com), which was my original creation years ago.

If you'd like to see this project grow, please consider giving it a star :star: — thank you!

There is no public-facing website hosted for this project at this time, and more details will be shared as development progresses.

<hr />

_A screenshot from the experimental Development UI in this project._

![Demo UI](./assets/images/development-ui.png)

## Running Locally

This project uses .NET Aspire for local orchestration. You can run it using Visual Studio or the command line.

### Prerequisites

- .NET 10 SDK
- Node.js 20.19+
- Docker Desktop (or compatible container runtime)
- Visual Studio (recent version) or Visual Studio Code

### Using Visual Studio

1. Open `Starlights.slnx` in Visual Studio.
2. Ensure `Starlights.AppHost` is set as the startup project with `https` as the launch profile.
3. Press **F5** to start debugging.

Once running, the Aspire Dashboard will launch automatically. From there, you can access the frontend application, backend API, and Scalar API documentation.

### Using Aspire CLI

To run the application using the Aspire CLI (see [aspire.dev](https://aspire.dev)), execute the following command in the root directory:

```bash
aspire run
```

This will start the AppHost, which orchestrates:

- **SQL Server**: A container (port `61070`)
- **Migrations**: Automatically applies EF Core migrations
- **Backend API**: The .NET Web API
- **Frontend**: The React/Vite application
- **Dashboard**: The Aspire dashboard for logs and metrics

### Initial Setup

Before using the application, initialize the sample data. In the Aspire Dashboard, locate the backend API resource and run the database initialization/seed action named **Initialize Database**.

## Running Tests

You can run the automated test suite using Visual Studio or the command line.

### Using Visual Studio 2026

1. Open the **Test Explorer** window (**Test** > **Test Explorer**).
2. Click the **Run All Tests** button (or press **Ctrl+R, A**).

### Using CLI

To run all tests, execute the following command in the root directory:

```bash
dotnet test
```

## Architecture

The project follows a **Modular Monolith** architecture, organized by business capability:

- **Elements Module**: Manages game data (classes, abilities, features, rules).
- **Characters Module**: Handles character creation and management.
- **Platform Layer**: Provides shared infrastructure (hosting, logging, data, eventing).

Each module is self-contained with its own domain logic, data persistence, and API endpoints.

## Acknowledgements

This project builds on my experience developing [Aurora](https://www.aurorabuilder.com), a character builder for Windows.

## License

This project is being developed in the open under the [MIT License](./LICENSE).
