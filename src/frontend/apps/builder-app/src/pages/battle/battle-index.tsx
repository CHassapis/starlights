/** The Battle Action Simulator's start: choose a character to take into a fight. */
import { SwordsIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCharacterList } from "@/lib/api/builder";
import { BATTLE_BACKGROUND } from "@/lib/art";
import { usePlayer } from "@/lib/player";
import { cn } from "@/lib/utils";

export function BattleIndexPage() {
  const { player } = usePlayer();
  const [everyone, setEveryone] = useState(!player);
  const list = useCharacterList(everyone ? null : player);
  const characters = [...(list.data?.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      <BattleBackdrop />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">Encounter helper</p>
        <h1 className="mt-2 font-heading text-4xl tracking-wide text-white drop-shadow sm:text-5xl">Battle Action Simulator</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/80 sm:text-base">
          Pick a character to see everything it can do on its turn: attacks with their real numbers, spells and what casting them higher does, the features it can use, and its hit points, slots and uses as the fight goes on.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          {player && (
            <Button size="sm" variant={everyone ? "outline" : "secondary"} onClick={() => setEveryone(false)}>
              {player}'s characters
            </Button>
          )}
          <Button size="sm" variant={everyone ? "secondary" : "outline"} onClick={() => setEveryone(true)}>
            Everyone's
          </Button>
        </div>

        {list.isLoading ? (
          <Spinner className="mx-auto my-16 size-6 text-white" />
        ) : characters.length === 0 ? (
          <p className="mt-10 rounded-lg border border-white/15 bg-black/40 p-6 text-white/80 backdrop-blur">
            No characters yet.{" "}
            <Link to="/characters/create" className="underline">
              Make one in the character builder
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => (
              <li key={c.characterId}>
                <Link
                  to={`/battle/${c.characterId}`}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border border-white/15 bg-black/45 p-3 text-white shadow-lg backdrop-blur-md transition",
                    "hover:border-amber-300/60 hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-amber-300",
                  )}
                >
                  {c.portraitUrl ? (
                    <img src={c.portraitUrl} alt="" className="size-14 shrink-0 rounded-lg border border-white/20 object-cover" />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/5">
                      <SwordsIcon className="size-6 text-amber-200/70" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-heading text-lg tracking-wide group-hover:text-amber-200">{c.name}</span>
                    <span className="block truncate text-xs text-white/70">
                      Level {c.level} {c.build}
                    </span>
                    {everyone && <span className="block truncate text-xs text-white/50">{c.playerName}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The heroic art behind the simulator, darkened so the text stays readable. */
export function BattleBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
      <div className="absolute inset-0 bg-neutral-950" />
      <img src={BATTLE_BACKGROUND} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%] opacity-60" onError={(e) => (e.currentTarget.style.display = "none")} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-neutral-950" />
    </div>
  );
}
