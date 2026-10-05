import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { saveCampaignDmToken, saveCampaignToken, unlockTokenHeader } from "@/lib/player";

export type EntryKind = "session" | "npc" | "encounter" | "place" | "faction" | "item" | "handout" | "quest" | "ledger" | "map" | "magicitem";

/** What the DM gives a party member: one of the campaign's magic items, an item of the books, and/or coins. */
export interface GiveInput {
  characterId: string;
  campaignItemId?: string | null;
  elementId?: string | null;
  baseElementId?: string | null;
  quantity: number;
  coins?: Record<string, number>;
  fromFund: boolean;
  note?: string;
  /** a picture to hand over with it (one uploaded to the campaign) */
  imageUrl?: string | null;
}

export interface CampaignSummary {
  id: string;
  name: string;
  description: string;
  coverUrl?: string | null;
  party: string[];
  locked: boolean;
  canOpen: boolean;
  updatedAt: string;
  /** who runs it */
  dmName?: string | null;
  /** whether this browser runs it */
  dm?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  coverUrl?: string | null;
  party: string[];
  locked: boolean;
  updatedAt: string;
  dmName?: string | null;
  hasDmPassword?: boolean;
  /** only in the answer to creating it */
  dmToken?: string | null;
}

export interface PartyMember {
  characterId: string;
  name: string;
  playerName?: string | null;
  level?: number | null;
  build?: string | null;
  portraitUrl?: string | null;
  locked: boolean;
  missing: boolean;
}

export interface CampaignEntry {
  id: string;
  kind: EntryKind;
  title: string;
  number?: number | null;
  occurredOn?: string | null;
  visible: boolean;
  body: string;
  /** only for the DM */
  dmNotes?: string | null;
  imageUrl?: string | null;
  data: Record<string, unknown>;
  sort: number;
  updatedAt: string;
}

export interface CampaignView {
  campaign: Campaign;
  party: PartyMember[];
  entries: CampaignEntry[];
  dm: boolean;
}

export type EntryInput = Omit<CampaignEntry, "id" | "updatedAt" | "dmNotes"> & { dmNotes: string };

const BASE = import.meta.env.VITE_API_BASE ?? "https://localhost:7246";

export class CampaignLockedError extends Error {}

/** The campaign list; locked campaigns the reader has not opened show only their names. */
export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiClient.get<{ campaigns: CampaignSummary[]; dm: boolean }>("/api/campaigns"),
  });
}

/**
 * A campaign as the reader may see it. With asPlayer the DM's own token is left out of the request, so the server
 * answers as it would a player: that is what "view as player" shows, never a filter in the browser.
 */
export function useCampaign(id: string, asPlayer: boolean) {
  return useQuery({
    queryKey: ["campaigns", id, asPlayer ? "player" : "own"],
    queryFn: async () => {
      const tokens = unlockTokenHeader(!asPlayer);
      const response = await fetch(`${BASE}/api/campaigns/${id}`, { headers: tokens ? { "X-Player-Token": tokens } : {} });
      if (response.status === 401) throw new CampaignLockedError("This campaign has a password.");
      if (!response.ok) throw new Error(response.status === 404 ? "There is no such campaign." : `The campaign could not be loaded (${response.status}).`);
      return (await response.json()) as CampaignView;
    },
    retry: (count, error) => !(error instanceof CampaignLockedError) && count < 2,
  });
}

export function useCampaignActions(campaignId?: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["campaigns"] }).catch(() => {});
  const base = `/api/campaigns/${campaignId}`;
  return {
    create: useMutation({
      mutationFn: async (body: { name: string; description: string; party: string[]; dmName?: string; dmPassword?: string }) => {
        const created = await apiClient.post<typeof body, Campaign>("/api/campaigns", body);
        // whoever starts a campaign runs it, from this browser straight away
        if (created.dmToken) saveCampaignDmToken(created.id, created.dmToken);
        return created;
      },
      onSettled: refresh,
    }),
    setDm: useMutation({
      mutationFn: (body: { name: string; password: string }) => apiClient.put<typeof body, Campaign>(`${base}/dm`, body),
      onSettled: refresh,
    }),
    update: useMutation({
      mutationFn: (body: { name: string; description: string; coverUrl?: string | null; party: string[] }) => apiClient.put<typeof body, Campaign>(base, body),
      onSettled: refresh,
    }),
    remove: useMutation({ mutationFn: () => apiClient.delete(base), onSettled: refresh }),
    setPassword: useMutation({
      mutationFn: (password: string) => apiClient.put<{ password: string }, void>(`${base}/password`, { password }),
      onSettled: refresh,
    }),
    saveEntry: useMutation({
      mutationFn: ({ id, ...entry }: EntryInput & { id?: string }) =>
        id ? apiClient.put<EntryInput, CampaignEntry>(`${base}/entries/${id}`, entry) : apiClient.post<EntryInput, CampaignEntry>(`${base}/entries`, entry),
      onSettled: refresh,
    }),
    removeEntry: useMutation({ mutationFn: (id: string) => apiClient.delete(`${base}/entries/${id}`), onSettled: refresh }),
    uploadImage: (data: string) => apiClient.post<{ data: string }, { url: string }>(`${base}/images`, { data }),
    give: useMutation({
      mutationFn: (input: GiveInput) => apiClient.post<GiveInput, { given: string }>(`${base}/give`, input),
      onSettled: (_r, _e, input) => {
        refresh();
        // the character's equipment and sheet change too
        qc.invalidateQueries({ queryKey: ["builder", input.characterId] }).catch(() => {});
        qc.invalidateQueries({ queryKey: ["sheet", input.characterId] }).catch(() => {});
      },
    }),
  };
}

/** Gives a campaign's DM password: this browser then runs the campaign. */
export async function unlockCampaignDm(campaignId: string, password: string) {
  const { token } = await apiClient.post<{ password: string }, { token: string }>(`/api/campaigns/${campaignId}/dm-unlock`, { password });
  saveCampaignDmToken(campaignId, token);
}

/** Gives a campaign's password; the token is kept like a player's. */
export async function unlockCampaign(campaignId: string, password: string) {
  const { token } = await apiClient.post<{ password: string }, { token: string }>(`/api/campaigns/${campaignId}/unlock`, { password });
  saveCampaignToken(campaignId, token);
}

export function useCampaignMembership() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["campaigns"] }).catch(() => {});
  return {
    join: useMutation({
      mutationFn: ({ campaignId, characterId }: { campaignId: string; characterId: string }) =>
        apiClient.post<{ characterId: string }, Campaign>(`/api/campaigns/${campaignId}/party`, { characterId }),
      onSettled: refresh,
    }),
    leave: useMutation({
      mutationFn: ({ campaignId, characterId }: { campaignId: string; characterId: string }) => apiClient.delete(`/api/campaigns/${campaignId}/party/${characterId}`),
      onSettled: refresh,
    }),
  };
}
