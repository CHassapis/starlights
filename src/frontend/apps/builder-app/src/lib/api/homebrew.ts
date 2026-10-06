/**
 * The group's homebrew made on the Homebrew page: magic items (imported as Aurora items, so the builder treats them
 * like book items) and monsters (stat blocks for campaigns' encounters). Reading is open; saving needs the admin.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { homebrewSources, type SourceBook } from "@/lib/api/sources";
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
  /** a magic weapon's own damage dice ("1d6"), instead of its base weapon's */
  damage?: string | null;
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

const bookNames = async () => (await apiClient.get<{ sources: SourceBook[] }>("/api/elements/sources")).sources.map((s) => s.name);

/**
 * Sources lists the books a character has switched off, so a homebrew book that did not exist before would be on for
 * every character. After a homebrew save brings in a new book, it is switched off for all of them: a player who wants
 * it ticks it in their Sources.
 */
export async function withNewBooksOff(save: () => Promise<unknown>) {
  const before = new Set(await bookNames());
  await save();
  const { sources } = await apiClient.get<{ sources: SourceBook[] }>("/api/elements/sources");
  const fresh = homebrewSources(sources).filter((name) => !before.has(name));
  if (fresh.length === 0) return;
  const { characters } = await apiClient.get<{ characters: { characterId: string }[] }>("/api/characters");
  for (const c of characters) {
    const path = `/api/characters/${c.characterId}/sources`;
    const { restricted } = await apiClient.get<{ restricted: string[] }>(path);
    const add = fresh.filter((name) => !restricted.includes(name));
    if (add.length) await apiClient.put(path, { restricted: [...restricted, ...add] });
  }
}

export function useHomebrewActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of [["homebrew"], ["compendium"], ["sources"], ["item-catalog"], ["items"]]) qc.invalidateQueries({ queryKey: key }).catch(() => {});
  };
  return {
    saveItem: useMutation({
      mutationFn: async (item: HomebrewItem) => {
        let saved: HomebrewItem | undefined;
        await withNewBooksOff(async () => (saved = await apiClient.put<HomebrewItem, HomebrewItem>("/api/elements/homebrew/items", item)));
        return saved!;
      },
      onSettled: refresh,
    }),
    deleteItem: useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/elements/homebrew/items/${encodeURIComponent(id)}`), onSettled: refresh }),
    saveMonster: useMutation({ mutationFn: (m: HomebrewMonster) => apiClient.put<HomebrewMonster, HomebrewMonster>("/api/elements/homebrew/monsters", m), onSettled: refresh }),
    deleteMonster: useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/elements/homebrew/monsters/${encodeURIComponent(id)}`), onSettled: refresh }),
  };
}
