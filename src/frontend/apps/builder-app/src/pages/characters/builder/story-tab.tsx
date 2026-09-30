import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import DescriptionProseSection from "@/components/description-section";
import { ImageDrop } from "@/components/image-drop";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { findOrganization, useOrganizations } from "@/lib/api/lore";
import { shrinkImage } from "@/lib/image";
import { cn } from "@/lib/utils";

// the character's story as named text fields; the keys match what the Aurora import fills in
export const STORY_DETAILS: [string, string][] = [
  ["gender", "Gender"],
  ["age", "Age"],
  ["height", "Height"],
  ["weight", "Weight"],
  ["eyes", "Eyes"],
  ["skin", "Skin"],
  ["hair", "Hair"],
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

      <OrganizationCard characterId={characterId} fields={fields} change={change} />

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

/**
 * The character's organization, like Aurora's: a name (one of the Forgotten Realms factions, with its write-up
 * from 5etools, or anything you write yourself), a symbol picture and the allies text.
 */
function OrganizationCard({
  characterId,
  fields,
  change,
}: {
  characterId: string;
  fields: Record<string, string>;
  change: (key: string, value: string) => void;
}) {
  const { data } = useOrganizations();
  const organizations = data?.organizations;
  const known = findOrganization(organizations, fields.organization);
  const [open, setOpen] = useState(false);
  const html = useMemo(() => (known ? DOMPurify.sanitize(known.html, { FORBID_ATTR: ["style"] }) : ""), [known]);

  const upload = useMutation({
    mutationFn: async (file: File) =>
      apiClient.post<{ data: string }, { url: string }>(`/api/characters/${characterId}/images`, { data: await shrinkImage(file, 400) }),
    onSuccess: ({ url }) => change("organizationSymbol", url),
    onError: (e) => toast.error("Could not upload the picture", { description: e.message }),
  });

  return (
    <section className="space-y-3">
      <h3 className="font-heading text-lg">Allies & organizations</h3>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Organization</span>
            <Input
              list="organization-names"
              placeholder="Pick a faction or write your own"
              value={fields.organization ?? ""}
              onChange={(e) => change("organization", e.target.value)}
            />
            <datalist id="organization-names">
              {organizations?.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.group}
                </option>
              ))}
            </datalist>
          </label>
          {known && (
            <div className="rounded-lg border">
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(!open)}>
                <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                <span className="flex-1">About the {known.name.replace(/^The\s+/, "")}</span>
                <span className="text-xs text-muted-foreground">{known.source}</span>
              </button>
              {open && (
                <DescriptionProseSection className="prose-sm max-h-96 overflow-y-auto border-t px-4 py-2 [&_table]:block [&_table]:overflow-x-auto">
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                </DescriptionProseSection>
              )}
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Allies, contacts and about the organization</span>
            <textarea rows={6} className={textareaClass} value={fields.allies ?? ""} onChange={(e) => change("allies", e.target.value)} />
          </label>
        </div>
        <div className="w-40 shrink-0 space-y-1 self-center sm:self-start">
          <span className="block text-center text-sm text-muted-foreground">Symbol</span>
          <ImageDrop
            className="size-40"
            label="Add a symbol"
            imageUrl={fields.organizationSymbol || null}
            busy={upload.isPending}
            onFile={(file) => upload.mutate(file)}
            onRemove={() => change("organizationSymbol", "")}
          />
        </div>
      </div>
    </section>
  );
}
