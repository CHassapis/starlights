import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import type { CharacterFacts, Inventory, InventoryEntry } from "@/lib/rules/items";

const inventoryKey = (characterId: string) => ["builder", characterId, "inventory"];

export function useInventory(characterId: string) {
  return useQuery({
    queryKey: inventoryKey(characterId),
    queryFn: () => apiClient.get<Inventory>(`/api/characters/${characterId}/inventory`),
  });
}

/**
 * Saves the inventory. Each change starts from the latest cached inventory (so a delayed save of a text box cannot
 * undo a change made meanwhile), shows at once, and rolls back if saving fails. The server applies active items'
 * rules before answering, so the sheet and statistics are refreshed afterwards.
 */
export function useSaveInventory(characterId: string) {
  const qc = useQueryClient();
  const key = inventoryKey(characterId);
  const mutation = useMutation({
    mutationFn: (inventory: Inventory) => apiClient.put<Inventory, void>(`/api/characters/${characterId}/inventory`, inventory),
    onMutate: async (inventory) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Inventory>(key);
      qc.setQueryData(key, inventory);
      return { previous };
    },
    onError: (_e, _v, context) => context?.previous && qc.setQueryData(key, context.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["sheet", characterId] }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["builder", characterId, "facts"] }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["builder", characterId, "choices"] }).catch(() => {});
    },
  });

  /** Changes the latest inventory with a function and saves it. */
  function update(change: (current: Inventory) => Partial<Inventory>, onError?: (e: Error) => void) {
    const current = qc.getQueryData<Inventory>(key);
    if (!current) return;
    mutation.mutate({ ...current, ...change(current) }, { onError });
  }
  const updateEntry = (id: string, change: Partial<InventoryEntry>, onError?: (e: Error) => void) =>
    update((current) => ({ items: current.items.map((e) => (e.id === id ? { ...e, ...change } : e)) }), onError);

  return { ...mutation, update, updateEntry };
}

interface Registration {
  associatedElementId: string;
  children?: Registration[];
}

/**
 * What the inventory rules need from the character: ability modifiers, proficiency bonus, statistics and the Aurora
 * ids of everything it has (for weapon proficiencies).
 */
export function useCharacterFacts(characterId: string): { facts?: CharacterFacts & { strength: number }; isLoading: boolean } {
  const base = `/api/characters/${characterId}`;
  const abilities = useQuery({
    queryKey: ["builder", characterId, "facts", "abilities"],
    queryFn: () => apiClient.get<{ abilityScores: { abbreviation: string; calculatedScore: number; calculatedModifier: number }[] }>(`${base}/ability-scores`),
  });
  const statistics = useQuery({
    queryKey: ["builder", characterId, "facts", "statistics"],
    queryFn: () => apiClient.get<{ statistics: { groupName: string; totalValue: number }[] }>(`${base}/statistics`),
  });
  const registrations = useQuery({
    queryKey: ["builder", characterId, "facts", "registrations"],
    queryFn: () => apiClient.get<{ registrations: Registration[] }>(`${base}/registrations`),
  });
  const elementIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (list: Registration[]) => list.forEach((r) => (ids.add(r.associatedElementId), walk(r.children ?? [])));
    walk(registrations.data?.registrations ?? []);
    return [...ids].sort();
  }, [registrations.data]);
  const auroraIds = useQuery({
    queryKey: ["builder", characterId, "facts", "aurora-ids", elementIds.join(",")],
    enabled: elementIds.length > 0,
    queryFn: async () => {
      const ids = new Set<string>();
      for (let i = 0; i < elementIds.length; i += 300) {
        const chunk = elementIds.slice(i, i + 300).join(",");
        const { entries } = await apiClient.get<{ entries: { auroraId: string | null }[] }>(`/api/elements/compendium/batch?ids=${chunk}`);
        entries.forEach((e) => e.auroraId && ids.add(e.auroraId));
      }
      return ids;
    },
    staleTime: 60_000,
  });

  const facts = useMemo(() => {
    if (!abilities.data || !statistics.data) return undefined;
    const stats = new Map(statistics.data.statistics.map((s) => [s.groupName, s.totalValue]));
    const mods = new Map(abilities.data.abilityScores.map((a) => [a.abbreviation, a.calculatedModifier]));
    return {
      mod: (a: string) => mods.get(a) ?? 0,
      proficiencyBonus: stats.get("proficiency") ?? 2,
      stat: (n: string) => stats.get(n),
      statNames: [...stats.keys()],
      has: auroraIds.data ?? new Set<string>(),
      strength: abilities.data.abilityScores.find((a) => a.abbreviation === "STR")?.calculatedScore ?? 10,
    } as CharacterFacts & { strength: number };
  }, [abilities.data, statistics.data, auroraIds.data]);

  return { facts, isLoading: abilities.isLoading || statistics.isLoading };
}
