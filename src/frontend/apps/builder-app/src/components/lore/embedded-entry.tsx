/**
 * A stat block (or spell, item, …) printed inside a book's text: {"type": "statblock", "tag": "creature",
 * "name": "…", "source": "…"}. Loads that entry's file and shows it in a frame, or a link while it loads.
 */
import { TAG_CATEGORY } from "@/lib/lore/categories";
import { tagKey, useLoreEntry } from "@/lib/lore/data";
import { Spinner } from "@/components/ui/spinner";
import { useLoreRender } from "./render-context";
import { EntryView } from "./entry-view";
import { LoreLink } from "./lore-link";

export function EmbeddedEntry({ entry }: { entry: Record<string, unknown> }) {
  const { meta } = useLoreRender();
  const tag = typeof entry.tag === "string" ? entry.tag : "creature";
  const name = typeof entry.name === "string" ? entry.name : "";
  const category = TAG_CATEGORY[tag];
  const key = category ? tagKey(meta, tag, name, typeof entry.source === "string" ? entry.source : undefined) : "";
  const loaded = useLoreEntry(meta, category ?? "", category && meta.categories[category] ? key : null);

  if (!category || !meta.categories[category]) return <p className="my-3 font-medium">{name}</p>;
  return (
    <div className="my-4 rounded-lg border bg-card/60 p-3 sm:p-4">
      {loaded.isLoading ? (
        <Spinner className="mx-auto my-3 size-5" />
      ) : loaded.data?.entry ? (
        <EntryView meta={meta} category={category} entry={loaded.data.entry} compact />
      ) : (
        <LoreLink category={category} k={key}>
          {name}
        </LoreLink>
      )}
    </div>
  );
}
