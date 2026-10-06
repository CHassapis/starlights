/**
 * Encounter mode's server side: the fight the DM runs on an encounter, read by the DM in full and by players without
 * its secrets (the server leaves them out), the DM's changes, and players marking conditions on creatures from their
 * Battle Action Simulator. Everything is polled every few seconds while a fight runs.
 */
import { ApiError } from "@starlights/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { EMPTY_FIGHT, type Fight } from "@/lib/rules/encounter";

export interface FightView {
  campaignId: string;
  campaignName: string;
  entryId: string;
  title: string;
  dm: boolean;
  fight: Fight;
}

const POLL = 3000;
const fightKey = (campaignId: string, entryId: string) => ["fight", campaignId, entryId];

const normal = (v: FightView): FightView => ({ ...v, fight: { ...EMPTY_FIGHT, ...v.fight, combatants: (v.fight.combatants ?? []).map((c) => ({ ...c, conditions: c.conditions ?? [] })) } });

/** One encounter's fight (null when it is not running and the reader is not the DM). */
export function useFight(campaignId: string, entryId: string) {
  return useQuery({
    queryKey: fightKey(campaignId, entryId),
    queryFn: async () => {
      try {
        return normal(await apiClient.get<FightView>(`/api/campaigns/${campaignId}/entries/${entryId}/fight`));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    refetchInterval: POLL,
  });
}

/**
 * The DM changes the fight: the change is applied to the latest copy and saved; when someone changed it meanwhile
 * (a player marked a condition), it is applied again to theirs.
 */
export function useChangeFight(campaignId: string, entryId: string) {
  const qc = useQueryClient();
  const key = fightKey(campaignId, entryId);
  const url = `/api/campaigns/${campaignId}/entries/${entryId}/fight`;
  return useMutation({
    mutationFn: async (change: (f: Fight) => Fight) => {
      let latest = qc.getQueryData<FightView | null>(key) ?? null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const base = latest?.fight ?? EMPTY_FIGHT;
        try {
          return normal(await apiClient.put<{ fight: Fight; revision: number }, FightView>(url, { fight: change(base), revision: base.revision }));
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) throw e;
          latest = normal(JSON.parse(e.body) as FightView);
        }
      }
      throw new Error("The encounter keeps changing; try again.");
    },
    onMutate: async (change) => {
      // show the change at once
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<FightView | null>(key);
      if (before) qc.setQueryData<FightView>(key, { ...before, fight: change(before.fight) });
      return { before };
    },
    onError: (_e, _change, context) => {
      if (context?.before) qc.setQueryData(key, context.before);
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
  });
}

/** A player marks a condition on a creature (or takes it off), as their character in the party. */
export function useMarkFight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: { campaignId: string; entryId: string; characterId: string; combatantId: string; condition: string; on: boolean }) =>
      apiClient.post<{ characterId: string; combatantId: string; condition: string; on: boolean }, FightView>(`/api/campaigns/${m.campaignId}/entries/${m.entryId}/fight/mark`, {
        characterId: m.characterId,
        combatantId: m.combatantId,
        condition: m.condition,
        on: m.on,
      }),
    onSuccess: (saved, m) => {
      qc.setQueryData(fightKey(m.campaignId, m.entryId), normal(saved));
      qc.invalidateQueries({ queryKey: ["fights", m.characterId] }).catch(() => {});
    },
  });
}

/** The fights running in the campaigns this character plays in (for its simulator); empty when there are none. */
export function useActiveFights(characterId: string) {
  return useQuery({
    queryKey: ["fights", characterId],
    queryFn: async () => (await apiClient.get<{ fights: FightView[] }>(`/api/campaigns/fights?characterId=${characterId}`)).fights.map(normal),
    refetchInterval: POLL,
    retry: false,
  });
}
