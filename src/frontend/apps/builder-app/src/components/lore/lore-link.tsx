/**
 * A cross-reference in the compendium's text ({@spell fireball}): a link to the entry's page, with a preview card
 * when you point at it or focus it, and a bottom sheet on a touch screen (tap for the preview, then "Open").
 * Works like the builder's info cards (same hover/touch rule).
 */
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCanHover } from "@/components/info-card";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { loreHref } from "@/lib/lore/data";
import { EntryPreview } from "./entry-view";

export function LoreLink({ category, k, children }: { category: string; k: string; children: ReactNode }) {
  const canHover = useCanHover();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const href = loreHref(category, k);
  const linkClass = "text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring rounded-sm";

  if (!canHover) {
    return (
      <>
        <a
          href={href}
          className={linkClass}
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          {children}
        </a>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader className="sr-only">
              <DrawerTitle>Preview</DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">{open && <EntryPreview category={category} k={k} />}</div>
            <div className="border-t px-4 py-3">
              <Link to={href} onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                <ExternalLinkIcon className="size-4" /> Open the full page
              </Link>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Link
          to={href}
          className={linkClass}
          onMouseEnter={() => later(() => setOpen(true), 350)}
          onMouseLeave={() => later(() => setOpen(false), 200)}
          onFocus={() => later(() => setOpen(true), 350)}
          onBlur={() => later(() => setOpen(false), 200)}
          onClick={() => setOpen(false)}
        >
          {children}
        </Link>
      </PopoverAnchor>
      <PopoverContent
        className="max-h-[60vh] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto"
        onMouseEnter={() => timer.current && clearTimeout(timer.current)}
        onMouseLeave={() => later(() => setOpen(false), 200)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {open && <EntryPreview category={category} k={k} />}
      </PopoverContent>
    </Popover>
  );
}
