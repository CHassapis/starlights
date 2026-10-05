import { InfoIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ElementDetails } from "@/components/element-details";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCanHover } from "@/hooks/use-can-hover";

/**
 * Explains an element where it is named: point at it (or focus it with the keyboard) for a card with what it does;
 * click to keep the card open; on a phone, tap for a bottom sheet. The details load only when first opened and
 * are cached. With `icon`, the trigger is a small ⓘ button after the children instead of the children themselves.
 */
export function InfoCard({ id, children, icon = false, className }: { id: string | null | undefined; children?: ReactNode; icon?: boolean; className?: string }) {
  const canHover = useCanHover();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!id) return <>{children}</>;

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const show = () => later(() => setOpen(true), 350);
  const hide = () => !pinned && later(() => setOpen(false), 200);
  const keep = () => timer.current && clearTimeout(timer.current);

  const trigger = (
    <button
      type="button"
      aria-label={icon ? "What is this?" : undefined}
      aria-expanded={open}
      className={cn(
        icon
          ? "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          : "cursor-help text-left decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:underline focus-visible:underline",
        className,
      )}
      onClick={() => {
        if (!canHover) return setOpen(true);
        setPinned(!pinned || !open);
        setOpen(!pinned || !open);
      }}
      onMouseEnter={canHover ? show : undefined}
      onMouseLeave={canHover ? hide : undefined}
      onFocus={canHover ? () => setOpen(true) : undefined}
      onBlur={canHover ? hide : undefined}
    >
      {icon ? <InfoIcon className="size-3.5" /> : children}
    </button>
  );

  if (!canHover) {
    return (
      <>
        {icon && children}
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader className="sr-only">
              <DrawerTitle>Details</DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[75vh] overflow-y-auto px-4 pb-6">{open && <ElementDetails id={id} />}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPinned(false);
      }}
    >
      {icon && children}
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      <PopoverContent
        className="w-96 max-w-[calc(100vw-2rem)]"
        onMouseEnter={keep}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {open && <ElementDetails id={id} compact />}
      </PopoverContent>
    </Popover>
  );
}
