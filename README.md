# Project Starlights

> **About this fork (branch `aurora-server`).** A self-hosted build of Project Starlights by C Hassapis, packaged to
> run in Docker for a D&D group. All credit for Starlights and Aurora Builder goes to their creator, **Bas Driessen**
> ([swdriessen/starlights](https://github.com/swdriessen/starlights), [aurorabuilder.com](https://www.aurorabuilder.com)).
> The content comes from [Aurora Legacy](https://github.com/AuroraLegacy/elements) and the Compendium's data from
> [5etools](https://github.com/5etools-mirror-3/5etools-src). Unofficial fan project, not affiliated with or endorsed by
> Wizards of the Coast; no book content is part of this repository. The original README follows the fork's sections.

**Contents:** [What this fork adds](#what-this-fork-adds) · [Install](#install-with-docker) ·
[Using it](#using-it) · [Settings](#settings) · [Content](#how-aurora-legacy-and-5etools-are-connected) ·
[Updating](#updating) · [Backups](#backups-and-restoring) · [Playing away from home](#playing-away-from-home) ·
[Troubleshooting](#troubleshooting) · [Removing it](#removing-it) · [Credits](#credits-and-legal)

## What this fork adds

- **Docker install** for one machine: `deploy/setup.sh` sets everything up, and the app downloads its own content.
- **Content page**: paste the GitHub links for Aurora Legacy and 5etools (or your forks) and the server downloads,
  imports and wires everything: the builder's rules, the Compendium of Lore, and every character updated.
- **Character wizard** for new players: class, species, background, ability scores, the books' starting equipment
  (packages or gold) and spells, one step at a time, with a skip to the full builder.
- **Character sheets like Aurora's**, on screen and as PDF, with the portrait sized and placed as you like and a last
  page showing the whole picture; bring in players' Aurora character files.
- **Builder**: multiclassing, 2014 and 2024 rules (or both), Save / Discard, items that cast spells, extra feats,
  languages and proficiencies.
- **Battle Action Simulator**: attacks, spells, slots and charges, familiars, conditions; magic items under the action
  they take (wands and staffs cast, potions, charms with charges); prepare spells right there, and cast one the player
  forgot to prepare (the DM's call).
- **Campaigns** with a DM's side: sessions, NPCs, places, quests, maps, handouts, magic items to hand out, notes, and a
  Gold tab with the party fund and stash. The Magic items tab shows who carries each item. Players only see what the
  DM reveals.
- **Encounters run as fights**: initiative, turns, monster hit points (hidden from players), and the party's hit points,
  armor class (magic items included), passive Perception and conditions straight from their simulators.
- **Trading**: players give each other items and coins from their Equipment tab.
- **Homebrew page**: make magic items (weapons can have their own damage dice) and monsters in a form, or upload Aurora
  element files. Homebrew is off by default: a player ticks it in a character's Sources, and a DM switches on
  "Use homebrew" in a campaign's settings.
- **Compendium of Lore**: the books, creatures, spells and items from the 5etools data, linkable from campaigns.
- Player names instead of accounts, with optional passwords; an admin password for the DM.

## Install with Docker

### What you need

- A computer that stays on while you play: a home server, a spare PC or a NAS that runs Docker.
  - **64-bit Intel/AMD (x86-64) only.** The database (Microsoft SQL Server) has no ARM version, so a Raspberry Pi
    won't work; an Apple Silicon Mac only through Docker Desktop's x86 emulation, slowly.
  - **4 GB of RAM** or more (the database takes up to 2 GB) and **about 3 GB of disk** (more with portraits).
- **Linux** (or Windows with WSL 2 and Docker Desktop), with **Docker and its compose plugin**, `git`, `curl`,
  `openssl` and `python3`. On Ubuntu or Debian: `sudo apt install git curl openssl python3` and Docker from
  [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
- An internet connection for the first setup (the app downloads about 200 MB of content, plus the Docker images).

### Setting it up

```bash
git clone -b aurora-server https://github.com/CHassapis/starlights.git
cd starlights/deploy
./setup.sh
```

The first run takes 10 to 20 minutes (building the app is the slow part). `setup.sh` is safe to run again; it skips what
is done. It:

1. writes `deploy/.env` with random passwords. Your **admin password** is `STARLIGHTS_MASTER_PASSWORD` in that file;
2. builds and starts three containers: the database, the API and the web app;
3. has the app download Aurora Legacy's elements and the 5etools data from GitHub, import them (about 14,000 elements)
   and build the Compendium of Lore. It shows each step as it goes.

When it finishes it prints the address, `http://<this machine>:8093` (for example `http://192.168.1.20:8093`), and the
admin password. Everyone on your home network can open that address in a browser, on a phone too. The site restarts by
itself after a reboot.

## Using it

### Players

1. Open the site and **pick your name** (top right). There are no accounts: your characters are filed under your name.
   To stop others changing them, use **Lock your characters** to give your name a password.
2. **Create Character**. Pick the rules (2014, 2024 or both) and leave "Guide me step by step" ticked if you're new:
   the wizard walks through class, species, background, ability scores, the books' starting equipment and spells.
   Experienced players untick it and go straight to the full builder (tabs: Build, Abilities, Magic, Equipment, Story,
   Sources). Already have an Aurora character? Use **Import from Aurora** with its `.dnd5e` file.
3. Changes are kept only when you press **Save** in the bar at the bottom (or **Discard changes** to go back).
4. **Character sheet** shows the sheet and downloads it as a PDF. **Battle** opens the Battle Action Simulator for
   playing: hit points, attacks, spells and slots, conditions, rests.
5. Join your group's campaign with the **Campaigns** button on your character (the DM may give you a password).

### The DM

1. Press the **key button** in the header and enter the admin password. It opens every character and campaign, and
   allows homebrew. (Anyone with it is a DM, so keep it to yourself.)
2. **Campaigns → New campaign.** In **Campaign settings** choose the party, add a cover, set a password for players
   and a DM password (so a co-DM can run it without the admin password), and switch on **Use homebrew** if you want it.
3. Everything you add starts hidden: players see an entry only when you reveal it. Use the **DM / Player** switch at the
   top to check what players see.
4. **Encounters → Run the fight**: add the party and the monsters, roll initiative, track hit points; players follow
   along in their simulators.
5. **Magic items → Give to…** puts an item straight into a character's equipment and notes it in the Gold tab.

### Homebrew

On the **Homebrew** page (admin password needed) make magic items and monsters with a form, or upload Aurora element
files (`.xml`) for classes, species, backgrounds and anything else. Homebrew starts switched off everywhere:

- a player ticks the homebrew book in their character's **Sources** tab to use it in the builder;
- a DM ticks **Use homebrew** in the campaign settings to hand out homebrew items and add homebrew monsters to fights.

## Settings

The settings live in `deploy/.env` (never share or commit it):

| Setting | What it is |
|---|---|
| `STARLIGHTS_MASTER_PASSWORD` | The admin password (key button). Change it any time, then `docker compose up -d`. |
| `STARLIGHTS_PORT` | The port the site is on (default `8093`). Change it, then `docker compose up -d`. |
| `STARLIGHTS_ADMIN_KEY` | Sent by `./admin.sh` for imports. Any long random text. |
| `STARLIGHTS_SA_PASSWORD` | The database password. Set once by `setup.sh`; **don't change it** after the first start (the database keeps the old one). |

## How Aurora Legacy and 5etools are connected

The app brings in its own content from two GitHub links, kept on its **Content** page (in the top bar once you unlock
admin with the key button):

| Content | Standard link | Used for |
|---|---|---|
| Aurora Legacy | [github.com/AuroraLegacy/elements](https://github.com/AuroraLegacy/elements) | classes, species, backgrounds, feats, spells, items: the builder's rules |
| 5etools | [github.com/5etools-mirror-3/5etools-src](https://github.com/5etools-mirror-3/5etools-src) | the Compendium of Lore, deities Aurora lacks, creatures for encounters, starting equipment |

To use your own fork (or a branch, as `…/tree/branch-name`), paste its link and press **Save and update now**. The
server then:

1. downloads each repository at its newest commit (skipped when nothing changed; for 5etools only its `data` folder);
2. sets up the base rules the first time;
3. imports Aurora Legacy, the 5etools deities and the built-in extras;
4. builds the Compendium of Lore;
5. runs every character through the rules again, so they get new choices.

Only GitHub links are accepted. The downloads live in `deploy/data/content`, the Compendium in `deploy/data/lore`, and
your homebrew (`deploy/data/homebrew`) is never touched. Optional extras:

- **Aurora's PDF sheets**: if you own Aurora Builder, copy the sheet templates and fonts from its install folder into
  `deploy/data/aurora-sheets` for PDF sheets laid out like Aurora's. Without them the on-screen sheet still works,
  but the PDF download doesn't.
- **Background pictures**: put `home-1.webp` … `home-5.webp`, `lore.webp` and `battle.webp` in `deploy/data/art`.

## Updating

New code:

```bash
cd starlights && git pull
cd deploy && docker compose build && docker compose up -d
```

New content: press **Save and update now** on the Content page, or run `./admin.sh update`. The database changes a new
version needs are applied by themselves when it starts. To get new content every night, add a cron job (`crontab -e`):

```
30 3 * * * cd /path/to/starlights/deploy && ./admin.sh update >> data/update.log 2>&1
```

`./admin.sh` (run it without arguments for help):

| Command | What it does |
|---|---|
| `./admin.sh update [--force]` | the same as the Content page's button: downloads what changed, imports it, rebuilds the Compendium, updates characters (`--force`: everything again) |
| `./admin.sh status` | what the content update is doing or last did |
| `./admin.sh import <index> [--update\|--replace]` | imports one index again: `AuroraLegacy.index`, `5etools`, `starlights` (built-in extras), `homebrew` |
| `./admin.sh reprocess` | runs every character through the rules again |

## Backups and restoring

Your group's data is the database, the portraits and the homebrew in `deploy/data` (the content clones can always be
downloaded again). Keep `deploy/.env` with the backup: the database only opens with its password. The files belong to
the containers' users, so the commands use a small helper container:

```bash
cd starlights/deploy
docker compose stop
docker run --rm -v "$PWD/data:/data" -v "$PWD:/backup" alpine \
  tar czf /backup/starlights-$(date +%F).tgz -C /data mssql portraits homebrew
docker compose start
```

To restore (replaces what is there now):

```bash
cd starlights/deploy
docker compose down
docker run --rm -v "$PWD/data:/data" -v "$PWD:/backup" alpine sh -c \
  'rm -rf /data/mssql /data/portraits /data/homebrew && tar xzf /backup/starlights-2026-01-31.tgz -C /data'
docker compose up -d
```

Copy the `.tgz` files somewhere else too (another disk, cloud storage).

## Playing away from home

Don't open the port on your router: the site serves book content for your table's private use and must not be on the
open internet. To play from anywhere, use a private network such as [Tailscale](https://tailscale.com) (free for
personal use): install it on the server and on each player's device, then open `http://<server's Tailscale name>:8093`.

## Troubleshooting

| Problem | What to do |
|---|---|
| `setup.sh` waits forever for the API | `docker compose logs starlights-api starlights-db`. The most common causes: less than 2 GB of free RAM, or an ARM computer. |
| "port is already allocated" | Another program uses 8093: set `STARLIGHTS_PORT=8094` (or another) in `.env` and run `docker compose up -d`. |
| The Compendium of Lore says it isn't set up | On the Content page press **Download everything again** (or `./admin.sh update --force`). |
| The content update stopped | The Content page shows the step and the reason. "GitHub did not answer" usually means its limit of 60 checks an hour: try again later. |
| New classes or options don't show after an update | `./admin.sh reprocess` |
| A player forgot their password | Unlock admin with the key button, pick that player's name (top right), and use **Change password** to set a new one or remove it. |
| You forgot the admin password | It's `STARLIGHTS_MASTER_PASSWORD` in `deploy/.env`. |
| Something else | `docker compose ps` shows what is running; `docker compose logs -f` follows the logs. |

## Removing it

```bash
cd starlights/deploy
docker compose down
docker run --rm -v "$PWD:/d" alpine rm -rf /d/data     # deletes everything, including characters and campaigns
docker rmi starlights/backend starlights/web
```

## Credits and legal

- [Project Starlights](https://github.com/swdriessen/starlights) and [Aurora Builder](https://www.aurorabuilder.com) by
  **Bas Driessen**: the app, its rules engine and the Aurora way of building characters (MIT licence, kept in
  [LICENSE](./LICENSE)).
- [Aurora Legacy](https://github.com/AuroraLegacy/elements): the community's content files.
- [5etools](https://github.com/5etools-mirror-3/5etools-src): the data behind the Compendium of Lore.
- This fork (Docker packaging and the features listed above) by C Hassapis.

Dungeons & Dragons and its books belong to Wizards of the Coast. This is an unofficial fan project, not approved or
endorsed by Wizards of the Coast. No book content is in this repository: `setup.sh` downloads it onto your own machine
for your own table's use.

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
