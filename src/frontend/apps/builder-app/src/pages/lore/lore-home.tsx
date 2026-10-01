/** The Compendium of Lore's front page: its categories with their sizes, and what you pinned and opened lately. */
import { BookOpenIcon, ClockIcon, PinIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { CATEGORIES, CATEGORY_BY_ID } from "@/lib/lore/categories";
import { LoreMissingError, useLoreMeta } from "@/lib/lore/data";
import { LoreMissing } from "./lore-missing";
import { usePins, useRecent, type EntryRef } from "./lore-storage";

function RefList({ title, icon, refs }: { title: string; icon: React.ReactNode; refs: EntryRef[] }) {
  if (refs.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-heading text-lg tracking-wide">
        {icon} {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {refs.slice(0, 16).map((r) => (
          <li key={`${r.category}/${r.key}`}>
            <Link to={`/lore/${r.category}/${r.key}`} className="inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-muted">
              {r.name}
              <span className="text-xs text-muted-foreground">{CATEGORY_BY_ID[r.category]?.singular}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LoreHome() {
  const meta = useLoreMeta();
  const pins = usePins();
  const recent = useRecent();
  if (meta.error instanceof LoreMissingError) return <LoreMissing />;
  if (meta.error) return <p className="p-8 text-center text-destructive">The compendium could not be loaded: {meta.error.message}</p>;
  if (!meta.data) return <Spinner className="mx-auto my-16 size-6" />;
  const built = CATEGORIES.filter((c) => meta.data.categories[c.id]);
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl tracking-wide sm:text-4xl">Compendium of Lore</h1>
        <p className="text-muted-foreground">Rules, creatures, items and the books themselves. Search a list, or point at any link in the text for a preview.</p>
      </header>
      <RefList title="Pinned" icon={<PinIcon className="size-4" />} refs={pins} />
      <RefList title="Recently opened" icon={<ClockIcon className="size-4" />} refs={recent} />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {built.map((c) => (
          <Link key={c.id} to={`/lore/${c.id}`} className="group rounded-lg border bg-background/60 p-4 transition-colors hover:border-primary/50 hover:bg-muted/40 motion-reduce:transition-none">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-heading text-lg tracking-wide group-hover:text-primary">{c.label}</span>
              <span className="text-sm text-muted-foreground">{meta.data.categories[c.id].count.toLocaleString()}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
          </Link>
        ))}
      </section>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BookOpenIcon className="size-3.5" /> Data: 5etools {meta.data.version.split("-")[0]}, built {new Date(meta.data.built).toLocaleDateString()}.
      </p>
    </div>
  );
}
