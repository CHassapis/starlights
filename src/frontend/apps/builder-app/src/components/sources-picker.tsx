import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { SourceBook } from "@/lib/api/sources";
import { cn } from "@/lib/utils";

const GROUP_LABELS: Record<string, { title: string; hint: string }> = {
  core: { title: "Core rulebooks", hint: "Player's Handbooks, Dungeon Master's Guides, Monster Manuals" },
  supplements: { title: "Supplements & adventures", hint: "Xanathar's, Tasha's, setting books, adventures" },
  "unearthed-arcana": { title: "Unearthed Arcana", hint: "Playtest material, not final rules" },
  collaborations: { title: "Collaborations", hint: "Partner and third-party content" },
  "5etools": { title: "From 5etools", hint: "Deities the Aurora files lack" },
  homebrew: { title: "Homebrew", hint: "Your group's own content (Homebrew page)" },
};

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: (checked: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-primary" />;
}

/**
 * Tick the source books a character uses, like Aurora's Sources tab: grouped by kind, a group can be switched
 * on or off as a whole or opened to pick single books.
 */
export function SourcesPicker({
  sources,
  restricted,
  onChange,
  loading,
}: {
  sources: SourceBook[] | undefined;
  restricted: string[];
  onChange: (restricted: string[]) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const off = useMemo(() => new Set(restricted), [restricted]);

  const groups = useMemo(() => {
    const map = new Map<string, SourceBook[]>();
    for (const s of sources ?? []) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group)!.push(s);
    }
    return [...map.entries()];
  }, [sources]);

  if (loading || !sources) return <Spinner className="mx-auto my-6 size-5" />;

  function setBooks(names: string[], use: boolean) {
    const next = new Set(off);
    for (const n of names) {
      if (use) next.delete(n);
      else next.add(n);
    }
    onChange([...next]);
  }

  return (
    <div className="divide-y rounded-lg border">
      {groups.map(([group, books]) => {
        const used = books.filter((b) => !off.has(b.name)).length;
        const label = GROUP_LABELS[group] ?? { title: group, hint: "" };
        const isOpen = open[group] ?? false;
        return (
          <div key={group}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox
                label={label.title}
                checked={used === books.length}
                indeterminate={used > 0 && used < books.length}
                onChange={(checked) => setBooks(books.map((b) => b.name), checked)}
              />
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen({ ...open, [group]: !isOpen })}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {used} of {books.length} books{label.hint ? ` · ${label.hint}` : ""}
                  </span>
                </span>
                <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              </button>
            </div>
            {isOpen && (
              <div className="grid gap-x-6 gap-y-1 px-3 pb-3 pl-10 sm:grid-cols-2">
                {books.map((book) => (
                  <label key={book.name} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                    <Checkbox label={book.name} checked={!off.has(book.name)} onChange={(checked) => setBooks([book.name], checked)} />
                    <span className="min-w-0 flex-1 truncate">{book.name}</span>
                    <span className="text-xs text-muted-foreground">{book.elements}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
