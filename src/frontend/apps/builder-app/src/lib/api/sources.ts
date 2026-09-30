import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface SourceBook {
  name: string;
  /** top folder of the content repository: core, supplements, unearthed-arcana, … */
  group: string;
  elements: number;
}

export function useSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: () => apiClient.get<{ sources: SourceBook[] }>("/api/elements/sources"),
    staleTime: Infinity,
  });
}

/** New characters start with everything except the Unearthed Arcana playtest material. */
export function defaultRestrictedSources(sources: SourceBook[]): string[] {
  return sources.filter((s) => s.group === "unearthed-arcana").map((s) => s.name);
}

export function useCharacterSources(characterId: string) {
  return useQuery({
    queryKey: ["builder", characterId, "sources"],
    queryFn: () => apiClient.get<{ restricted: string[] }>(`/api/characters/${characterId}/sources`),
  });
}

export function useSetCharacterSources(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restricted: string[]) => apiClient.put<{ restricted: string[] }, void>(`/api/characters/${characterId}/sources`, { restricted }),
    onMutate: (restricted) => qc.setQueryData(["builder", characterId, "sources"], { restricted }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["builder", characterId, "sources"] }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["builder", characterId, "options"] }).catch(() => {});
    },
  });
}
