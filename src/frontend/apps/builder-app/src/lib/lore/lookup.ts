import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { LORE_BASE, useLoreMeta } from "./data";

/** The compendium's search index: [name, category, key, source]. */
type Hit = [string, string, string, string];

/**
 * Finds compendium entries by name, for linking things outside the compendium (the Battle Action Simulator's
 * spells, conditions and actions). Prefers the 2024 Player's Handbook's version for 2024 rules, else the 2014 one.
 * Returns null while the index loads, or when the compendium is not set up.
 */
export function useLoreLookup() {
  const meta = useLoreMeta();
  const index = useQuery({
    queryKey: ["lore", meta.data?.version, "search"],
    queryFn: async () => (await (await fetch(`${LORE_BASE}/${meta.data!.version}/search.json`)).json()) as Hit[],
    enabled: !!meta.data,
    staleTime: Infinity,
  });
  const byName = useMemo(() => {
    const map = new Map<string, Hit[]>();
    for (const hit of index.data ?? []) {
      const key = `${hit[1]}|${hit[0].toLowerCase()}`;
      map.set(key, [...(map.get(key) ?? []), hit]);
    }
    return map;
  }, [index.data]);
  return useCallback(
    (category: string, name: string, edition: "2014" | "2024" = "2024"): string | null => {
      const hits = byName.get(`${category}|${name.toLowerCase().trim()}`);
      if (!hits?.length) return null;
      const prefer = edition === "2024" ? ["XPHB", "XDMG", "XMM"] : ["PHB", "DMG", "MM"];
      return (hits.find((h) => prefer.includes(h[3])) ?? hits[0])[2];
    },
    [byName],
  );
}
