import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import type { ItemInfo } from "@/lib/rules/items";

/**
 * The item catalog (every item with its categories, magic layer and figures). About 1 MB, sent gzipped and
 * revalidated with an ETag, so after the first load the browser only asks whether it changed.
 */
export function useItemCatalog() {
  const query = useQuery({
    queryKey: ["item-catalog"],
    queryFn: () => apiClient.get<{ version: number; items: ItemInfo[] }>("/api/elements/items"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const data = useMemo(() => (query.data ? { ...query.data, byId: new Map(query.data.items.map((i) => [i.id, i])) } : undefined), [query.data]);
  return { ...query, data };
}

/** The weapons or armor a magic item such as "Weapon, +1" can be made from. */
export function useBaseCandidates(itemId: string | null | undefined) {
  return useQuery({
    queryKey: ["item-bases", itemId],
    queryFn: () => apiClient.get<{ items: ItemInfo[] }>(`/api/elements/items/${itemId}/bases`),
    enabled: !!itemId,
    staleTime: 10 * 60_000,
  });
}
