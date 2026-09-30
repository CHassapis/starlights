import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface CompendiumListItem {
  id: string;
  name: string;
  type: string;
  source: string | null;
}

export interface CompendiumElementReference {
  id: string;
  name: string;
  type: string;
}

export interface CompendiumRule {
  kind: "include" | "statistic" | "selection";
  level: number;
  name: string | null;
  value: string | null;
  bonus: string | null;
  elementType: string | null;
  supports: string | null;
  quantity: number | null;
  element: CompendiumElementReference | null;
}

export interface CompendiumEntry {
  id: string;
  name: string;
  type: string;
  source: string | null;
  auroraId: string | null;
  auroraType: string | null;
  description: string;
  supports: string[];
  rules: CompendiumRule[];
}

export function useCompendium(): UseQueryResult<{ items: CompendiumListItem[] }, Error> {
  return useQuery({
    queryKey: ["compendium"],
    queryFn: () => apiClient.get<{ items: CompendiumListItem[] }>("/api/elements/compendium"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCompendiumEntry(id: string | null): UseQueryResult<CompendiumEntry, Error> {
  return useQuery({
    queryKey: ["compendium", id],
    queryFn: () => apiClient.get<CompendiumEntry>(`/api/elements/compendium/${encodeURIComponent(id!)}`),
    enabled: !!id,
    // keep showing the previous entry while the next one loads (no flicker when browsing a list)
    placeholderData: (previous) => previous,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
