import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, PuzzleIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ElementDetails } from "@/components/element-details";
import { InfoCard } from "@/components/info-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiClient } from "@/lib/api-client";
import type { BuilderChoice } from "@/lib/api/builder";
import { useItemCatalog } from "@/lib/api/items";
import type { ItemInfo } from "@/lib/rules/items";
import { normalizeText } from "@/lib/rules/picker";
import { cn } from "@/lib/utils";

interface Extra {
  id: string;
  elementId: string;
  name: string;
  categories: string[];
  applied: boolean;
}

function useExtras(characterId: string) {
  return useQuery({
    queryKey: ["builder", characterId, "extras"],
    queryFn: () => apiClient.get<{ extras: Extra[] }>(`/api/characters/${characterId}/extras`),
  });
}

function useChangeExtras(characterId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of [["builder", characterId], ["sheet", characterId]]) qc.invalidateQueries({ queryKey: key }).catch(() => {});
  };
  const add = useMutation({
    mutationFn: (elementId: string) => apiClient.post<{ elementId: string }, Extra>(`/api/characters/${characterId}/extras`, { elementId }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (extraId: string) => apiClient.delete(`/api/characters/${characterId}/extras/${extraId}`),
    onSettled: refresh,
  });
  return { add, remove };
}

/** How Aurora groups its extra build options, and the order they are offered in. */
const GROUPS = [
  { category: "Additional Feature", title: "Additional options", hint: "An extra feat, language, proficiency or spell; speeds, senses, companions" },
  { category: "Optional Class Features", title: "Optional class features", hint: "Tasha's optional features, by class" },
  { category: "Additional Ability Score Improvement", title: "Ability scores", hint: "+1 (or −1) to one ability score" },
];

// Aurora's own switches for features its app gates; Starlights does not gate them, so they would do nothing here
const isSwitch = (item: ItemInfo) => /unlocker$/i.test(item.name);

/**
 * Build options added on top of the normal build, like Aurora's "additional" options: the extras themselves (with a
 * card each and a way to take them off) and the choices they bring (the feat an Additional Feat lets you pick).
 */
export function ExtrasCard({ characterId, choices, renderChoice }: { characterId: string; choices: BuilderChoice[]; renderChoice: (choice: BuilderChoice) => ReactNode }) {
  const { data, isLoading } = useExtras(characterId);
  const { add, remove } = useChangeExtras(characterId);
  const [picking, setPicking] = useState(false);
  const extras = data?.extras ?? [];

  return (
    <section className="rounded-lg border bg-background/60">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <PuzzleIcon className="size-5 text-muted-foreground" />
        <h2 className="font-heading text-lg tracking-wide">Extras</h2>
        <Button size="sm" variant="outline" className="ms-auto" onClick={() => setPicking(true)}>
          <PlusIcon /> Add an extra option
        </Button>
      </div>
      <div className="space-y-3 p-4">
        {isLoading && <Spinner className="size-4" />}
        {!isLoading && extras.length === 0 && (
          <p className="text-sm text-muted-foreground">
            An extra feat, language, proficiency or spell, an optional class feature, a speed or sense your DM grants: add it here.
          </p>
        )}
        {extras.map((extra) => (
          <div key={extra.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <InfoCard id={extra.elementId} className="font-medium">
              {extra.name}
            </InfoCard>
            <span className="text-xs text-muted-foreground">{extra.categories[0]}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ms-auto"
              aria-label={`Remove ${extra.name}`}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(extra.id, { onError: (e) => toast.error("Could not remove it", { description: e.message }) })
              }
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {choices.map(renderChoice)}
      </div>
      <ExtrasPicker
        open={picking}
        onOpenChange={setPicking}
        onAdd={(item) =>
          add.mutate(item.id, {
            onSuccess: () => toast.success(`${item.name} added`),
            onError: (e) => toast.error("Could not add it", { description: e.message }),
          })
        }
      />
    </section>
  );
}

function ExtrasPicker({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (item: ItemInfo) => void }) {
  const isMobile = useIsMobile();
  const { data: catalog, isLoading } = useItemCatalog();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ItemInfo | null>(null);

  const groups = useMemo(() => {
    const q = normalizeText(query);
    const options = (catalog?.items ?? []).filter((i) => i.buildOption && !isSwitch(i) && (!q || normalizeText(i.name).includes(q)));
    return GROUPS.map((g) => ({
      ...g,
      items: options
        .filter((i) => i.categories.includes(g.category))
        // the built-in generic ones first, then Aurora's by name
        .sort((a, b) => Number(b.source === "Starlights") - Number(a.source === "Starlights") || a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length > 0);
  }, [catalog, query]);

  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isLoading && <Spinner className="mx-auto my-8 size-5" />}
      {groups.map((g) => (
        <div key={g.category} className="border-b pb-2">
          <p className="px-3 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</p>
          <p className="px-3 pb-1 text-xs text-muted-foreground">{g.hint}</p>
          {g.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", selected?.id === item.id ? "bg-muted" : "hover:bg-muted/60")}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.source === "Internal" ? "" : item.source}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const details = selected ? (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isMobile && (
          <button type="button" className="mb-3 text-sm text-muted-foreground" onClick={() => setSelected(null)}>
            ← Back to the list
          </button>
        )}
        <ElementDetails id={selected.id} />
      </div>
      <div className="border-t p-3">
        <Button className="w-full" onClick={() => onAdd(selected)}>
          <PlusIcon /> Add {selected.name}
        </Button>
      </div>
    </div>
  ) : (
    <p className="p-6 text-sm text-muted-foreground">Choose an option to read what it does.</p>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSelected(null);
      }}
    >
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile ? "h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none border-0" : "h-[80vh] w-[min(60rem,95vw)] max-w-none sm:max-w-none",
        )}
      >
        <DialogTitle className="px-4 pt-4 font-heading text-lg">Add an extra option</DialogTitle>
        <DialogDescription className="px-4 text-xs">Options the normal build does not give: your DM's boons, optional class features, extra feats and the like.</DialogDescription>
        {isMobile && selected ? (
          <div className="min-h-0 flex-1">{details}</div>
        ) : (
          <>
            <div className="relative p-3">
              <SearchIcon className="absolute left-5.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search options…" className="pl-8" aria-label="Search options" />
            </div>
            <div className="flex min-h-0 flex-1 border-t">
              <div className={cn("flex min-h-0 flex-col", isMobile ? "flex-1" : "w-1/2 border-r")}>{list}</div>
              {!isMobile && <div className="min-h-0 flex-1">{details}</div>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
