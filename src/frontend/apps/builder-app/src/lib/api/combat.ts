import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@starlights/api-client";
import { apiClient } from "@/lib/api-client";
import { EMPTY_COMBAT, type CombatState } from "@/lib/rules/battle";

const combatKey = (characterId: string) => ["builder", characterId, "combat"];

/**
 * The character's state in a fight: hit points lost, features spent, conditions (the Battle Action Simulator). It is
 * read again now and then, so healing a party member gave shows up; never while a save is on its way (what is shown
 * then is newer than the server's copy).
 */
export function useCombat(characterId: string) {
  const qc = useQueryClient();
  const key = combatKey(characterId);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const cached = qc.getQueryData<CombatState>(key);
      if (cached && qc.isMutating({ mutationKey: key }) > 0) return cached;
      return { ...EMPTY_COMBAT, ...(await apiClient.get<CombatState>(`/api/characters/${characterId}/combat`)) };
    },
    refetchInterval: 20_000,
  });
}

/**
 * Saves the fight's state; each change starts from the latest cached state, shows at once and rolls back on failure.
 * When a party member changed the character meanwhile (a potion they gave it), the server refuses the save and sends
 * its state, and the change is made again on top of it, so neither is lost.
 */
export function useSaveCombat(characterId: string) {
  const qc = useQueryClient();
  const key = combatKey(characterId);
  const url = `/api/characters/${characterId}/combat`;
  type Change = (current: CombatState) => CombatState;
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: async ({ next, change }: { next: CombatState; change: Change }) => {
      try {
        return await apiClient.put<CombatState, CombatState>(url, next);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        const fresh = { ...EMPTY_COMBAT, ...(JSON.parse(e.body) as CombatState) };
        // another save that was refused too may have caught up with the server already: build on it then
        const cached = qc.getQueryData<CombatState>(key);
        const base = cached && (cached.received ?? 0) >= (fresh.received ?? 0) ? cached : fresh;
        const again = change(base);
        qc.setQueryData(key, again);
        return await apiClient.put<CombatState, CombatState>(url, again);
      }
    },
    onMutate: async ({ next }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CombatState>(key);
      qc.setQueryData(key, next);
      return { previous };
    },
    onError: (_e, _v, context) => context?.previous && qc.setQueryData(key, context.previous),
  });

  /** Changes the latest state with a function and saves it (nothing is sent when it does not change). */
  function update(change: Change, onError?: (e: Error) => void) {
    const current = qc.getQueryData<CombatState>(key) ?? EMPTY_COMBAT;
    const next = change(current);
    if (next !== current) mutation.mutate({ next, change }, { onError });
  }

  return { ...mutation, update };
}

/**
 * A magic item used on another member of a campaign's party (a potion given, "a creature you touch regains 2d8 hit
 * points"): the healing or temporary hit points rolled go into that character's fight state. The answer only names
 * them: their hit points stay theirs and the DM's.
 */
export function useItemEffect(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: { campaignId: string; toCharacterId: string; kind: "heal" | "tempHp"; amount: number }) =>
      apiClient.post<object, { name: string }>(`/api/campaigns/${e.campaignId}/item-effect`, {
        fromCharacterId: characterId,
        toCharacterId: e.toCharacterId,
        kind: e.kind,
        amount: e.amount,
      }),
    onSuccess: (_r, e) => qc.invalidateQueries({ queryKey: combatKey(e.toCharacterId) }).catch(() => {}),
  });
}
