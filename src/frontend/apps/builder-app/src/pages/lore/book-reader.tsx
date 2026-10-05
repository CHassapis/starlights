/**
 * Reading a book or adventure: its contents beside the text (a sheet on a phone), one chapter at a time with the
 * previous and next ones a click away, links to any section (?ch=2#e-123), and a search through the whole book
 * that jumps to the section it found.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, ListIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Entry, LoreRenderProvider } from "@/components/lore/render";
import { LORE_BASE, LoreMissingError, useLoreMeta } from "@/lib/lore/data";
import { normalize } from "@/lib/lore/search";
import type { BookSearchSection, BookToc, LoreMeta } from "@/lib/lore/types";
import { cn } from "@/lib/utils";
import { LoreMissing } from "./lore-missing";
import { rememberRecent } from "./lore-storage";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 404 ? "There is no such book." : `Could not load (${r.status})`);
  return (await r.json()) as T;
}

export function BookReader() {
  const meta = useLoreMeta();
  if (meta.error instanceof LoreMissingError) return <LoreMissing />;
  if (!meta.data) return <Spinner className="mx-auto my-16 size-6" />;
  return <Reader meta={meta.data} />;
}

function Contents({ toc, kind, id, chapter, onPick }: { toc: BookToc; kind: string; id: string; chapter: number; onPick?: () => void }) {
  return (
    <nav aria-label="Contents" className="space-y-0.5 text-sm">
      {toc.toc.map((c, i) => (
        <div key={i}>
          <Link
            to={`/lore/${kind}/${id}?ch=${i}`}
            onClick={onPick}
            aria-current={i === chapter ? "page" : undefined}
            className={cn("block rounded px-2 py-1 leading-snug hover:bg-muted", i === chapter && "bg-primary/10 font-medium text-primary")}
          >
            {c.ordinal && <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{c.ordinal}</span>}
            {c.name}
          </Link>
          {i === chapter && c.headers.length > 0 && (
            <ul className="my-1 ml-3 border-l pl-2">
              {c.headers
                .filter((h) => h.depth <= 1 && h.id)
                .map((h, j) => (
                  <li key={j}>
                    <Link to={`/lore/${kind}/${id}?ch=${i}#e-${h.id}`} onClick={onPick} className={cn("block py-0.5 text-xs text-muted-foreground hover:text-foreground", h.depth === 1 && "pl-3")}>
                      {h.name}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

function snippet(text: string, query: string): string {
  const at = normalize(text).indexOf(normalize(query));
  const start = Math.max(0, at - 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 180)}${start + 180 < text.length ? "…" : ""}`;
}

function BookSearch({ meta, kind, id, toc }: { meta: LoreMeta; kind: string; id: string; toc: BookToc }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const wanted = query.trim().length >= 3;
  const index = useQuery({
    queryKey: ["lore", meta.version, "book-search", kind, id],
    queryFn: () => get<BookSearchSection[]>(`${LORE_BASE}/${meta.version}/reader/${kind}/${id}/search.json`),
    enabled: wanted,
    staleTime: Infinity,
  });
  const results = useMemo(() => {
    if (!wanted || !index.data) return [];
    const q = normalize(query);
    return index.data.filter((s) => normalize(s.name).includes(q) || normalize(s.text).includes(q)).slice(0, 50);
  }, [wanted, index.data, query]);
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input className="pl-8" placeholder="Search this book" aria-label="Search this book" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
      {wanted && (
        <div className="absolute inset-x-0 top-11 z-30 max-h-[60vh] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
          {index.isLoading ? (
            <Spinner className="mx-auto my-3 size-4" />
          ) : results.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nothing found.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  setQuery("");
                  navigate(`/lore/${kind}/${id}?ch=${r.ch}#e-${r.id}`);
                }}
              >
                <span className="block text-sm font-medium">{r.name}</span>
                <span className="block text-[11px] text-muted-foreground">{toc.toc[r.ch]?.name}</span>
                <span className="line-clamp-2 block text-xs text-muted-foreground">{snippet(r.text, query)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Reader({ meta }: { meta: LoreMeta }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const kind = location.pathname.startsWith("/lore/adventures") ? "adventures" : "books";
  const [params] = useSearchParams();
  const chapter = Math.max(0, Number(params.get("ch") ?? 0) || 0);
  const [contentsOpen, setContentsOpen] = useState(false);
  const base = `${LORE_BASE}/${meta.version}/reader/${kind}/${id}`;
  const toc = useQuery({ queryKey: ["lore", meta.version, "toc", kind, id], queryFn: () => get<BookToc>(`${base}/toc.json`), staleTime: Infinity });
  const content = useQuery({ queryKey: ["lore", meta.version, "chapter", kind, id, chapter], queryFn: () => get<unknown>(`${base}/${chapter}.json`), staleTime: Infinity, enabled: !!toc.data });

  useEffect(() => {
    if (!toc.data) return;
    document.title = `${toc.data.name} · Compendium of Lore`;
    rememberRecent({ category: kind, key: id, name: toc.data.name, source: toc.data.source });
    return () => {
      document.title = "Starlights";
    };
  }, [toc.data, kind, id]);

  // after a chapter is drawn, go to the section in the address (by id, or by a header's name from a book link)
  useEffect(() => {
    if (!content.data || !toc.data) return;
    const hash = decodeURIComponent(location.hash.slice(1));
    let target = hash ? document.getElementById(hash) : null;
    if (hash && !target) {
      const header = toc.data.toc[chapter]?.headers.find((h) => h.name.toLowerCase() === hash.toLowerCase());
      if (header?.id) target = document.getElementById(`e-${header.id}`);
    }
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [content.data, toc.data, chapter, location.hash]);

  if (toc.error) return <p className="p-8 text-center text-destructive">{toc.error.message}</p>;
  if (!toc.data) return <Spinner className="mx-auto my-16 size-6" />;
  const book = toc.data;
  const chapters = book.toc.length;
  const ctx = { meta, book: { kind, id, chapterOf: (entryId: string) => book.ids[entryId] } } as const;
  const pager = (
    <div className="flex items-center justify-between gap-2 print:hidden">
      {chapter > 0 ? (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/lore/${kind}/${id}?ch=${chapter - 1}`}>
            <ChevronLeftIcon /> <span className="sm:hidden">Previous</span>
            <span className="hidden max-w-48 truncate sm:inline">{book.toc[chapter - 1].name}</span>
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {chapter < chapters - 1 && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/lore/${kind}/${id}?ch=${chapter + 1}`}>
            <span className="sm:hidden">Next</span>
            <span className="hidden max-w-48 truncate sm:inline">{book.toc[chapter + 1].name}</span> <ChevronRightIcon />
          </Link>
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground print:hidden">
        <Link to="/lore" className="hover:text-foreground">
          Compendium of Lore
        </Link>
        <span>/</span>
        <Link to={`/lore/${kind}`} className="hover:text-foreground">
          {kind === "books" ? "Books" : "Adventures"}
        </Link>
        <span>/</span>
        <span className="text-foreground">{book.name}</span>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] print:block">
        <aside className="hidden lg:block print:hidden">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] space-y-3 overflow-y-auto pr-1">
            <BookSearch meta={meta} kind={kind} id={id} toc={book} />
            <Contents toc={book} kind={kind} id={id} chapter={chapter} />
          </div>
        </aside>
        <main className="min-w-0 space-y-4">
          <div className="flex gap-2 lg:hidden print:hidden">
            <Button variant="outline" onClick={() => setContentsOpen(true)}>
              <ListIcon /> Contents
            </Button>
            <div className="flex-1">
              <BookSearch meta={meta} kind={kind} id={id} toc={book} />
            </div>
          </div>
          {pager}
          <article className="@container max-w-3xl rounded-lg border print:max-w-none print:border-0 print:p-0 bg-background/60 p-4 text-[0.97rem] sm:p-8">
            {content.isLoading ? (
              <Spinner className="mx-auto my-8 size-6" />
            ) : content.error ? (
              <p className="text-destructive">{content.error.message}</p>
            ) : (
              <LoreRenderProvider value={ctx}>
                <Entry entry={content.data} depth={0} />
              </LoreRenderProvider>
            )}
          </article>
          {pager}
        </main>
      </div>
      <Sheet open={contentsOpen} onOpenChange={setContentsOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <SheetHeader className="flex-row items-center justify-between">
            <SheetTitle>{book.name}</SheetTitle>
            <Button variant="ghost" size="icon" onClick={() => setContentsOpen(false)} aria-label="Close">
              <XIcon />
            </Button>
          </SheetHeader>
          <div className="px-3 pb-6">
            <Contents toc={book} kind={kind} id={id} chapter={chapter} onPick={() => setContentsOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
