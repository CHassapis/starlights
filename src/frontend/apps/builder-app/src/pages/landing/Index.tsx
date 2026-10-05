import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { HourlyBackdrop } from "@/components/hourly-backdrop";
import { BATTLE_BACKGROUND, LORE_BACKGROUND } from "@/lib/art";

function LandingTile({
  title,
  description,
  url,
  image,
  size = "lg",
  tag = undefined,
  enabled = true,
}: {
  title: string;
  description: string;
  url: string;
  image?: string;
  size?: "sm" | "lg";
  tag?: string;
  enabled?: boolean;
}) {
  const isLarge = size === "lg";

  return (
    <>
      <Link
        to={url}
        className={`block h-full relative overflow-hidden rounded-xl group border-4 border-double shadow-lg ${enabled ? "" : "pointer-events-none"} `}
      >
        {image ? (
          <img
            src={image}
            alt={title}
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 scale-100 group-hover:scale-105 ${
              enabled ? "" : "grayscale-85 group-hover:grayscale-0 "
            }`}
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-muted to-background" />
        )}

        <div className="absolute inset-0 bg-linear-to-tr from-black/40 group-hover:from-black/20 to-transparent" />
        {/* 
        <div className="absolute rounded-lg rotate-160 w-20 h-20 -top-7 -right-5 bg-accent shadow-2xl"></div>
        <SwordsIcon className="absolute  top-1 right-4 size-6 rotate-0 opacity-20 mt-2.5 ms-2.5" /> */}

        <div
          className={`prose prose-neutral dark:prose-invert absolute text-white ${
            isLarge ? "left-2 right-2 bottom-2 sm:left-8 sm:right-8 sm:bottom-8" : "left-2 right-2 bottom-2 sm:left-4 sm:right-4 sm:bottom-4"
          }  `}
        >
          {isLarge ? (
            <>
              <h3 className="text-lg! sm:text-3xl! text-white mb-0">{title}</h3>
              <p className="text-sm sm:text-base">{description}</p>
            </>
          ) : (
            <>
              <h3 className="text-base sm:text-xl! text-white mb-0 mt-1">{title}</h3>
              <p className="text-xs sm:text-sm">{description}</p>
            </>
          )}
        </div>
        <div className={` absolute ${isLarge ? "left-2 right-2 top-2 sm:left-8 sm:right-8 sm:top-8" : "left-2 top-2 sm:left-4 sm:right-4 sm:top-4"}  `}>
          {tag === undefined ? null : (
            <>
              <Badge variant={"outline"} className="backdrop-blur text-white border-white/50">
                {tag}
              </Badge>
            </>
          )}
        </div>
      </Link>
    </>
  );
}

const tiles = [
  {
    title: "Character Builder",
    description: "Craft and chronicle your adventurers with every Aurora book, 2014 and 2024 rules side by side.",
    url: "/characters",
    image: "/images/spiritdragon_olivierbernard_full.jpg",
  },
  {
    title: "Battle Action Simulator",
    description: "Pick a character and see everything it can do this turn, with real numbers.",
    url: "/battle",
    image: BATTLE_BACKGROUND,
  },
  {
    title: "Campaign Ledger",
    description: "Quests, NPCs, sessions, maps and loot for the whole table.",
    url: "/campaigns",
    image: "/images/drow.jpg",
  },
  {
    title: "Compendium of Lore",
    description: "Spells, items, monsters and every book, searchable and linked together.",
    url: "/lore",
    image: LORE_BACKGROUND,
  },
];

export function LandingPage2() {
  return (
    <>
      <HourlyBackdrop />
      <header className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-starlights-purple-600 dark:text-starlights-purple-400">Your table's companion</p>
        <h1 className="mt-2 font-heading text-4xl tracking-wide sm:text-5xl">Project Starlights</h1>
        <p className="mt-3 text-muted-foreground sm:text-lg">Build characters, run campaigns, look anything up and play out every turn of a fight, all in one place.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5 sm:grid-rows-2 sm:h-[34rem]">
        <div className="h-72 sm:col-span-3 sm:row-span-2 sm:h-auto">
          <LandingTile {...tiles[0]} />
        </div>
        <div className="h-44 sm:col-span-2 sm:h-auto">
          <LandingTile {...tiles[1]} size="sm" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
          <div className="h-44 sm:h-auto">
            <LandingTile {...tiles[2]} size="sm" />
          </div>
          <div className="h-44 sm:h-auto">
            <LandingTile {...tiles[3]} size="sm" />
          </div>
        </div>
      </div>

      <section className="my-12 grid gap-6 sm:grid-cols-3">
        {[
          ["Characters", "Every Aurora book and Aurora Legacy's newest content; the sheet prints exactly like Aurora's."],
          ["At the table", "Campaigns with a locked DM side, player notes, and the Battle Action Simulator for each turn."],
          ["Reference", "The Compendium of Lore with every rule, monster and book, linked from wherever you are."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border bg-background/60 p-4 backdrop-blur-sm">
            <h2 className="font-heading text-lg tracking-wide">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
