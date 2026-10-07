import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FastForwardIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { BuilderChoice } from "@/lib/api/builder";
import { cn } from "@/lib/utils";
import { AbilitiesTab } from "./abilities-tab";
import { MagicTab } from "./magic-tab";
import { useCharacterHeader } from "@/lib/api/builder";
import { PortraitFramer } from "./portrait-framer";
import { StartingEquipment } from "./starting-equipment";

interface Step {
  id: string;
  title: string;
  hint: string;
  /** the builder's sections this step's choices come from */
  sections?: string[];
}

const STEPS: Step[] = [
  { id: "rules", title: "Rules", hint: "Which rules does your table play? Ask your DM. Not sure? Pick “Both, mixed”: everything works together. Leave the books below as they are." },
  { id: "class", title: "Class", hint: "Your class is what your character is good at: fighting, magic, sneaking, healing. Open the list and point at a class to read about it. Some classes then ask for more picks, such as skills.", sections: ["Class"] },
  { id: "species", title: "Species", hint: "Your species (race in the older books) gives you a few traits: darkvision, a speed, a resistance. Pick the one you like the look of.", sections: ["Species"] },
  { id: "background", title: "Background", hint: "Your background is what you did before adventuring. It gives skills and, in the 2024 rules, your ability score increases and an origin feat. Alignment and a god are optional.", sections: ["Background", "Alignment", "Deity"] },
  { id: "abilities", title: "Ability scores", hint: "Strength, Dexterity, Constitution, Intelligence, Wisdom and Charisma. Put your best scores in what your class uses most (its description says which)." },
  { id: "equipment", title: "Equipment", hint: "What the books say you start with, from your class and your background. Choose an option in each group, then add it to your equipment." },
  { id: "spells", title: "Spells", hint: "If your class casts spells, choose them here. Not a spellcaster? Just go on." },
  { id: "done", title: "Done", hint: "Your character is ready to play. Save it with the bar at the bottom of the page." },
];

/**
 * The builder step by step for new players: rules, class, species, background, ability scores, the books'
 * starting equipment and spells, one at a time with a short explanation. The same choices as the full builder, so
 * anyone can skip to it at any point.
 */
export function Wizard({
  characterId,
  choices,
  renderChoice,
  rules,
  aside,
  onExit,
}: {
  characterId: string;
  choices: BuilderChoice[];
  renderChoice: (choice: BuilderChoice, hideLabel: boolean) => ReactNode;
  rules: ReactNode;
  aside: ReactNode;
  onExit: () => void;
}) {
  const [at, setAt] = useState(0);
  const portraitUrl = useCharacterHeader(characterId).data?.character.portraitUrl;
  const step = STEPS[at];
  const heading = useRef<HTMLElement>(null);
  const pills = useRef<HTMLOListElement>(null);
  const first = useRef(true);
  // a new step starts at its top (on a phone Next is far down the page), and its button slides into view in the strip
  useEffect(() => {
    pills.current?.querySelector<HTMLElement>("[aria-current=step]")?.scrollIntoView({ block: "nearest", inline: "center" });
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [at]);
  const of = (s: Step) => choices.filter((c) => s.sections?.includes(c.section));
  const open = (s: Step) => of(s).filter((c) => !c.optional && !c.selected).length;
  const shown = of(step);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">Step by step.</span>
          <span className="hidden sm:inline"> One thing at a time, with a short explanation. Know what you're doing?</span>
        </p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onExit}>
          <FastForwardIcon /> <span className="sm:hidden">Full builder</span>
          <span className="hidden sm:inline">Skip to the full builder</span>
        </Button>
      </div>

      {/* one row that slides sideways on a phone, wrapping on wider screens */}
      <ol ref={pills} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="Steps">
        {STEPS.map((s, i) => {
          const left = open(s);
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setAt(i)}
                aria-current={i === at ? "step" : undefined}
                className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm", i === at ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                <span className="tabular-nums opacity-70">{i + 1}</span> {s.title}
                {s.sections && (left === 0 ? <CheckIcon className="size-3.5" /> : <span className="rounded-full bg-amber-500/90 px-1.5 text-[10px] text-black">{left}</span>)}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section className="min-w-0 space-y-4">
          <header ref={heading} className="scroll-mt-20">
            <h2 className="font-heading text-2xl font-semibold">
              {at + 1}. {step.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.hint}</p>
          </header>

          {step.id === "rules" && rules}
          {step.sections && (shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to choose here yet: pick a class first.</p> : <div className="space-y-2 rounded-lg border p-3">{shown.map((c) => renderChoice(c, c.depth === 0 && step.sections!.includes(c.name)))}</div>)}
          {step.id === "abilities" && <AbilitiesTab characterId={characterId} />}
          {step.id === "equipment" && <StartingEquipment characterId={characterId} choices={choices} />}
          {step.id === "spells" && <MagicTab characterId={characterId} />}
          {step.id === "done" && (
            <div className="space-y-3">
              {STEPS.filter((s) => s.sections && open(s) > 0).map((s) => (
                <p key={s.id} className="text-sm text-amber-700 dark:text-amber-300">
                  {s.title}: {open(s)} {open(s) === 1 ? "choice is" : "choices are"} still open.{" "}
                  <button type="button" className="underline" onClick={() => setAt(STEPS.indexOf(s))}>
                    Go back to it
                  </button>
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to={`/characters/${characterId}/sheet`}>
                    <ScrollTextIcon /> See the character sheet
                  </Link>
                </Button>
                <Button variant="outline" onClick={onExit}>
                  Open the full builder
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">The full builder has everything else: the Story tab, extra feats and languages, levelling up, and the Equipment tab.</p>
              <section className="space-y-3 rounded-lg border p-3">
                <h3 className="font-medium">Your portrait on the sheet</h3>
                {portraitUrl ? (
                  <PortraitFramer characterId={characterId} portraitUrl={portraitUrl} />
                ) : (
                  <p className="text-sm text-muted-foreground">No portrait yet: add one with the picture box at the top of the page, then place it here.</p>
                )}
              </section>
            </div>
          )}

          <div className="flex items-center gap-2 border-t pt-4">
            <Button variant="outline" disabled={at === 0} onClick={() => setAt(at - 1)}>
              <ArrowLeftIcon /> Back
            </Button>
            <span className="flex-1" />
            {at < STEPS.length - 1 && (
              <Button onClick={() => setAt(at + 1)}>
                Next: {STEPS[at + 1].title} <ArrowRightIcon />
              </Button>
            )}
          </div>
        </section>
        {step.sections ? <aside className="hidden lg:block">{aside}</aside> : <div className="hidden lg:block" />}
      </div>
    </div>
  );
}
