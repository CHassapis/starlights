import { useQuery } from "@tanstack/react-query";
import { LanguagesIcon } from "lucide-react";
import { useMemo } from "react";
import { InfoCard } from "@/components/info-card";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { summarizeProficiencies, type ProficiencyEntry, type ProficiencyRegistration } from "@/lib/rules/proficiencies";

const GROUPS: { key: keyof ReturnType<typeof summarizeProficiencies>; title: string; always?: boolean }[] = [
  { key: "savingThrows", title: "Saving throws", always: true },
  { key: "skills", title: "Skills", always: true },
  { key: "armor", title: "Armor", always: true },
  { key: "weapons", title: "Weapons", always: true },
  { key: "tools", title: "Tools", always: true },
  { key: "languages", title: "Languages", always: true },
  { key: "other", title: "Other" },
];

/**
 * Everything the character is proficient in and the languages it speaks, like the Proficiencies & Languages box on
 * Aurora's sheet, with where each one comes from. Point at a name for what it covers.
 */
export function ProficienciesCard({ characterId }: { characterId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["builder", characterId, "registrations"],
    queryFn: () => apiClient.get<{ registrations: ProficiencyRegistration[] }>(`/api/characters/${characterId}/registrations`),
  });
  const summary = useMemo(() => (data ? summarizeProficiencies(data.registrations) : null), [data]);

  return (
    <section className="rounded-lg border bg-background/60">
      <h2 className="flex items-center gap-2 border-b px-4 py-3 font-heading text-lg tracking-wide">
        <LanguagesIcon className="size-5 text-muted-foreground" />
        Proficiencies &amp; Languages
      </h2>
      {isLoading || !summary ? (
        <Spinner className="m-4 size-4" />
      ) : (
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          {GROUPS.filter((g) => g.always || summary[g.key].length > 0).map((g) => (
            <div key={g.key} className="min-w-0">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              {summary[g.key].length === 0 ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {summary[g.key].map((e) => (
                    <Entry key={e.name} entry={e} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Entry({ entry }: { entry: ProficiencyEntry }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <InfoCard id={entry.elementId}>{entry.name}</InfoCard>
      {entry.expertise && (
        <span title="Expertise: twice your proficiency bonus" className="rounded border px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-muted-foreground">
          expertise
        </span>
      )}
      {entry.sources.length > 0 && <span className="text-xs text-muted-foreground">{entry.sources.join(" · ")}</span>}
    </li>
  );
}
