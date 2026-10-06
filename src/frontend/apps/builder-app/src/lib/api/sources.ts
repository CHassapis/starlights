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

/** New characters start with everything except the Unearthed Arcana playtest material and the group's homebrew. */
export function defaultRestrictedSources(sources: SourceBook[]): string[] {
  return sources.filter((s) => s.group === "unearthed-arcana" || s.group === "homebrew").map((s) => s.name);
}

/** The homebrew books, which a campaign shows only when its DM switches on "Use homebrew". */
export function homebrewSources(sources: SourceBook[]): string[] {
  return sources.filter((s) => s.group === "homebrew").map((s) => s.name);
}

/** Which rules a character is built with; both editions work together, so "mixed" allows everything. */
export type RulesEdition = "2014" | "2024" | "mixed";

/** The revised core books are named "… (2024)" or "… (2025)" (the 2025 Monster Manual). */
const REVISED = /\((2024|2025)\)\s*$/;

/** Books the 2024 rules replace; the edition-neutral "Aurora Legacy Essentials" (skills, languages) stays on. */
function isOriginalCore(s: SourceBook) {
  return s.group === "core" && !REVISED.test(s.name) && s.name !== "Aurora Legacy Essentials";
}

/**
 * The books switched off for an edition. Unearthed Arcana and homebrew always start off. 2014 turns off the revised core books;
 * 2024 turns off the 2014 core books and keeps every supplement (they work with the 2024 rules).
 */
export function restrictedForEdition(edition: RulesEdition, sources: SourceBook[]): string[] {
  const off = new Set(defaultRestrictedSources(sources));
  for (const s of sources) {
    if (edition === "2014" && REVISED.test(s.name)) off.add(s.name);
    if (edition === "2024" && isOriginalCore(s)) off.add(s.name);
  }
  return [...off];
}

/** The edition a set of switched-off books matches exactly, or null when the books were ticked by hand. */
export function editionOf(restricted: string[], sources: SourceBook[]): RulesEdition | null {
  const have = new Set(restricted);
  const editions: RulesEdition[] = ["mixed", "2014", "2024"];
  return (
    editions.find((edition) => {
      const off = restrictedForEdition(edition, sources);
      return off.length === have.size && off.every((s) => have.has(s));
    }) ?? null
  );
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
