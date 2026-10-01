/**
 * A long list with rows of one height, of which only those in view (and a few around them) are in the page, so
 * thousands of rows scroll smoothly on a phone. The highlighted row is kept in view when it moves with the keys.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function VirtualList<T>({
  items,
  rowHeight,
  render,
  highlight,
  className,
  label,
}: {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => ReactNode;
  highlight?: number;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = new ResizeObserver(() => setHeight(el.clientHeight));
    resize.observe(el);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || highlight == null || highlight < 0) return;
    const top = highlight * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
  }, [highlight, rowHeight]);

  // a new list (another search) starts at the top
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [items]);

  const overscan = 8;
  const first = Math.max(0, Math.floor(scroll / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((scroll + height) / rowHeight) + overscan);
  return (
    <div ref={ref} role="listbox" aria-label={label} className={cn("relative overflow-y-auto overscroll-contain", className)} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight }} className="relative">
        {items.slice(first, last).map((item, i) => (
          <div key={first + i} style={{ position: "absolute", top: (first + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
            {render(item, first + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
