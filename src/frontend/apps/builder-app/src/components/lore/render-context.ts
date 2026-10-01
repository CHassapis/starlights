/** What the entry renderer needs to know: the build (pictures, default books, which categories exist) and the book being read. */
import { createContext, useContext } from "react";
import type { LoreMeta } from "@/lib/lore/types";

export interface LoreRenderContext {
  meta: LoreMeta;
  /** the book or adventure being read, for {@area} links and section anchors */
  book?: { kind: "books" | "adventures"; id: string; chapterOf?: (entryId: string) => number | undefined };
}

export const RenderContext = createContext<LoreRenderContext | null>(null);

export function useLoreRender(): LoreRenderContext {
  const ctx = useContext(RenderContext);
  if (!ctx) throw new Error("LoreRenderProvider is missing");
  return ctx;
}

