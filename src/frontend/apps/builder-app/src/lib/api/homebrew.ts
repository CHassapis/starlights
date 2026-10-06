/**
 * The group's homebrew made on the Homebrew page: magic items (imported as Aurora items, so the builder treats them
 * like book items) and monsters (stat blocks for campaigns' encounters). Reading is open; saving needs the admin.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { HomebrewMonster } from "@/lib/rules/homebrew";

export interface HomebrewItem {
  id?: string | null;
  name: string;
  source?: string | null;
  kind: string;
  rarity: string;
  attunement: boolean;
  attunementBy?: string | null;
  charges?: number | null;
  base?: string | null;
  weight?: number | null;
  cost?: number | null;
  description: string;
}

export function useHomebrewItems() {
  return useQuery({ queryKey: ["homebrew", "items"], queryFn: async () => (await apiClient.get<{ items: HomebrewItem[] }>("/api/elements/homebrew/items")).items });
}

export function useHomebrewMonsters(enabled = true) {
  return useQuery({ queryKey: ["homebrew", "monsters"], enabled, queryFn: async () => (await apiClient.get<{ monsters: HomebrewMonster[] }>("/api/elements/homebrew/monsters")).monsters });
}

export function useHomebrewActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of [["homebrew"], ["compendium"], ["sources"], ["item-catalog"], ["items"]]) qc.invalidateQueries({ queryKey: key }).catch(() => {});
  };
  return {
    saveItem: useMutation({ mutationFn: (item: HomebrewItem) => apiClient.put<HomebrewItem, HomebrewItem>("/api/elements/homebrew/items", item), onSettled: refresh }),
    deleteItem: useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/elements/homebrew/items/${encodeURIComponent(id)}`), onSettled: refresh }),
    saveMonster: useMutation({ mutationFn: (m: HomebrewMonster) => apiClient.put<HomebrewMonster, HomebrewMonster>("/api/elements/homebrew/monsters", m), onSettled: refresh }),
    deleteMonster: useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/elements/homebrew/monsters/${encodeURIComponent(id)}`), onSettled: refresh }),
  };
}
