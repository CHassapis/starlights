import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";

// the character's story as named text fields; the keys match what the Aurora import fills in
export const STORY_DETAILS: [string, string][] = [
  ["gender", "Gender"],
  ["age", "Age"],
  ["height", "Height"],
  ["weight", "Weight"],
  ["eyes", "Eyes"],
  ["skin", "Skin"],
  ["hair", "Hair"],
  ["faith", "Faith"],
];
export const STORY_PERSONALITY: [string, string][] = [
  ["traits", "Personality traits"],
  ["ideals", "Ideals"],
  ["bonds", "Bonds"],
  ["flaws", "Flaws"],
];
export const STORY_LONG: [string, string, number][] = [
  ["backstory", "Backstory", 12],
  ["appearance", "Appearance", 4],
  ["background", "Background details", 4],
  ["features", "Additional features & traits", 5],
  ["allies", "Allies & organizations", 4],
  ["trinket", "Trinket", 2],
  ["quests", "Quests", 4],
  ["notes", "Notes", 6],
];

export function useCharacterStory(characterId: string) {
  return useQuery({
    queryKey: ["builder", characterId, "story"],
    queryFn: () => apiClient.get<{ fields: Record<string, string> }>(`/api/characters/${characterId}/story`),
  });
}

const textareaClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Backstory, personality, appearance and notes; saved automatically a moment after typing stops.
 */
export function StoryTab({ characterId }: { characterId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useCharacterStory(characterId);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (next: Record<string, string>) => apiClient.put<{ fields: Record<string, string> }, void>(`/api/characters/${characterId}/story`, { fields: next }),
    onSuccess: (_, next) => qc.setQueryData(["builder", characterId, "story"], { fields: next }),
  });

  useEffect(() => {
    if (data && fields === null) setFields(data.fields);
  }, [data, fields]);

  // save whatever is pending when leaving the tab
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (isLoading || fields === null) return <Spinner className="mx-auto my-8 size-5" />;

  function change(key: string, value: string) {
    const next = { ...fields, [key]: value };
    setFields(next);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save.mutate(next, { onSuccess: () => setDirty(false) });
    }, 800);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <p className="flex h-5 items-center gap-2 text-xs text-muted-foreground">
        {save.isPending || dirty ? (
          <>
            <Spinner className="size-3" /> Saving…
          </>
        ) : save.isSuccess ? (
          <>
            <CheckIcon className="size-3" /> Saved
          </>
        ) : (
          "Changes are saved automatically."
        )}
      </p>

      <section className="space-y-3">
        <h3 className="font-heading text-lg">Details</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STORY_DETAILS.map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input value={fields[key] ?? ""} onChange={(e) => change(key, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-heading text-lg">Personality</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {STORY_PERSONALITY.map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <textarea rows={4} className={textareaClass} value={fields[key] ?? ""} onChange={(e) => change(key, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      {STORY_LONG.map(([key, label, rows]) => (
        <section key={key} className="space-y-1">
          <label className="space-y-1 text-sm">
            <span className="font-heading text-lg">{label}</span>
            <textarea rows={rows} className={textareaClass} value={fields[key] ?? ""} onChange={(e) => change(key, e.target.value)} />
          </label>
        </section>
      ))}
    </div>
  );
}
