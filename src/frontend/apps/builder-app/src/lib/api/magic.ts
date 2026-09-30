import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import { EMPTY_MAGIC, type MagicState, type Spellcasting } from "@/lib/rules/magic";

/** A spell's figures from the spell index (level 0 and false flags are left out of the compact JSON). */
export interface SpellFigures {
  id: string;
  name: string;
  auroraId: string;
  source?: string;
  level?: number;
  school?: string;
  lists?: string[];
  ritual?: boolean;
  concentration?: boolean;
  castingTime?: string;
  range?: string;
  duration?: string;
  components?: string;
}

/** Every spell's level, school, ritual and concentration; revalidated with an ETag. */
export function useSpellIndex() {
  const query = useQuery({
    queryKey: ["spell-index"],
    queryFn: () => apiClient.get<{ version: number; spells: SpellFigures[] }>("/api/elements/spell-index"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const byId = useMemo(() => (query.data ? new Map(query.data.spells.map((s) => [s.id, s])) : undefined), [query.data]);
  return { ...query, byId };
}

/** How the character casts spells, worked out by the server from the build (changes with it). */
export function useSpellcasting(characterId: string) {
  return useQuery({
    queryKey: ["builder", characterId, "spellcasting"],
    queryFn: () => apiClient.get<Spellcasting>(`/api/characters/${characterId}/spellcasting`),
  });
}

const magicKey = (characterId: string) => ["builder", characterId, "magic"];

export function useMagic(characterId: string) {
  return useQuery({
    queryKey: magicKey(characterId),
    queryFn: async () => ({ ...EMPTY_MAGIC, ...(await apiClient.get<MagicState>(`/api/characters/${characterId}/magic`)) }),
  });
}

/**
 * Saves prepared spells and spent slots. Each change starts from the latest cached state, shows at once and rolls
 * back if saving fails; the sheet is refreshed afterwards (it marks prepared spells).
 */
export function useSaveMagic(characterId: string) {
  const qc = useQueryClient();
  const key = magicKey(characterId);
  const mutation = useMutation({
    mutationFn: (magic: MagicState) => apiClient.put<MagicState, MagicState>(`/api/characters/${characterId}/magic`, magic),
    onMutate: async (magic) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MagicState>(key);
      qc.setQueryData(key, magic);
      return { previous };
    },
    onError: (_e, _v, context) => context?.previous && qc.setQueryData(key, context.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: ["sheet", characterId] }).catch(() => {}),
  });

  /** Changes the latest state with a function and saves it (nothing is sent when it does not change). */
  function update(change: (current: MagicState) => MagicState, onError?: (e: Error) => void) {
    const current = qc.getQueryData<MagicState>(key) ?? EMPTY_MAGIC;
    const next = change(current);
    if (next !== current) mutation.mutate(next, { onError });
  }

  return { ...mutation, update };
}
