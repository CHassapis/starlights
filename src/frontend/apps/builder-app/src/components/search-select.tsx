import { CheckIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type SearchSelectOption = { id: string; name: string; hint?: string | null };

// long lists (all spells, all feats) render the first matches only; typing narrows them down
const MAX_SHOWN = 200;

/**
 * A dropdown with a search box, like Aurora's selection lists: type to filter, arrows + Enter to pick.
 * Options are usually loaded when the list opens (see onOpenChange). onHighlight reports the option under the
 * mouse or keyboard so a description panel can follow along.
 */
export function SearchSelect({
  value,
  valueLabel,
  valueHint,
  options,
  loading,
  placeholder = "Choose…",
  disabled,
  className,
  onOpenChange,
  onSelect,
  onClear,
  onHighlight,
}: {
  value?: string | null;
  valueLabel?: string | null;
  valueHint?: string | null;
  options?: SearchSelectOption[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onHighlight?: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (options ?? []).filter((o) => !q || o.name.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q));
  }, [options, query]);
  const shown = useMemo(() => filtered.slice(0, MAX_SHOWN), [filtered]);

  // start on the current pick when the list opens or its options arrive
  useEffect(() => {
    if (open) setActive(Math.max(0, shown.findIndex((o) => o.id === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options]);

  const activeId = open ? (shown[active]?.id ?? null) : null;
  useEffect(() => {
    onHighlight?.(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
    onOpenChange?.(next);
  }

  function pick(option: SearchSelectOption) {
    changeOpen(false);
    if (option.id !== value) onSelect(option.id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-xs transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50",
            !valueLabel && "border-dashed",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {valueLabel ? (
              <>
                {valueLabel}
                {valueHint && <span className="text-muted-foreground"> · {valueHint}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {loading ? (
          <div className="flex justify-center p-4">
            <Spinner className="size-5" />
          </div>
        ) : shown.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No options</p>
        ) : (
          <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.map((option, i) => (
              <li
                key={option.id}
                data-index={i}
                role="option"
                aria-selected={option.id === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={cn("flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm", i === active && "bg-muted")}
              >
                <CheckIcon className={cn("mt-0.5 size-4 shrink-0", option.id === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate">{option.name}</span>
                  {option.hint && <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > MAX_SHOWN && (
          <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            Showing {MAX_SHOWN} of {filtered.length}. Type to narrow down.
          </p>
        )}
        {value && onClear && (
          <button
            type="button"
            onClick={() => {
              changeOpen(false);
              onClear();
            }}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            <XIcon className="size-4" /> Clear choice
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
