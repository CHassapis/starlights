/** The pinned entries side by side (stacked on a phone), to compare two spells, creatures or items. */
import { PinOffIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EntryView } from "@/components/lore/entry-view";
import { useLoreEntry, useLoreMeta } from "@/lib/lore/data";
import type { LoreMeta } from "@/lib/lore/types";
import { togglePin, usePins, type EntryRef } from "./lore-storage";

function Column({ meta, pin }: { meta: LoreMeta; pin: EntryRef }) {
  const loaded = useLoreEntry(meta, pin.category, pin.key);
  return (
    <div className="min-w-0 space-y-2 rounded-lg border bg-background/60 p-4">
      <div className="flex justify-end print:hidden">
        <Button variant="ghost" size="sm" onClick={() => togglePin(pin)}>
          <PinOffIcon /> Unpin
        </Button>
      </div>
      {loaded.isLoading ? <Spinner className="mx-auto my-6 size-5" /> : loaded.data?.entry ? <EntryView meta={meta} category={pin.category} entry={loaded.data.entry} /> : <p className="text-sm text-muted-foreground">{pin.name} could not be loaded.</p>}
    </div>
  );
}

export function ComparePage() {
  const meta = useLoreMeta();
  const pins = usePins().filter((p) => p.category !== "books" && p.category !== "adventures");
  if (!meta.data) return <Spinner className="mx-auto my-16 size-6" />;
  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 px-4 py-4">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground print:hidden">
        <Link to="/lore" className="hover:text-foreground">
          Compendium of Lore
        </Link>
        <span>/</span>
        <span className="text-foreground">Compare</span>
      </nav>
      {pins.length === 0 ? (
        <p className="text-muted-foreground">Pin entries (the pin button on an entry) to compare them here.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pins.map((p) => (
            <Column key={`${p.category}/${p.key}`} meta={meta.data} pin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
