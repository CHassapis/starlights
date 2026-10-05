import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { EMPTY_COMBAT, type CombatState } from "@/lib/rules/battle";

const combatKey = (characterId: string) => ["builder", characterId, "combat"];

/** The character's state in a fight: hit points lost, features spent, conditions (the Battle Action Simulator). */
export function useCombat(characterId: string) {
  return useQuery({
    queryKey: combatKey(characterId),
    queryFn: async () => ({ ...EMPTY_COMBAT, ...(await apiClient.get<CombatState>(`/api/characters/${characterId}/combat`)) }),
  });
}

/** Saves the fight's state; each change starts from the latest cached state, shows at once and rolls back on failure. */
export function useSaveCombat(characterId: string) {
  const qc = useQueryClient();
  const key = combatKey(characterId);
  const mutation = useMutation({
    mutationFn: (combat: CombatState) => apiClient.put<CombatState, CombatState>(`/api/characters/${characterId}/combat`, combat),
    onMutate: async (combat) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CombatState>(key);
      qc.setQueryData(key, combat);
      return { previous };
    },
    onError: (_e, _v, context) => context?.previous && qc.setQueryData(key, context.previous),
  });

  /** Changes the latest state with a function and saves it (nothing is sent when it does not change). */
  function update(change: (current: CombatState) => CombatState, onError?: (e: Error) => void) {
    const current = qc.getQueryData<CombatState>(key) ?? EMPTY_COMBAT;
    const next = change(current);
    if (next !== current) mutation.mutate(next, { onError });
  }

  return { ...mutation, update };
}
