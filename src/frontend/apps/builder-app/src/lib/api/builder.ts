import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getCharacterClasses,
  getCharacterDetails,
  getSelectionRuleOptions,
  registerSelection,
  unregisterSelection,
  updateClassLevel,
  type CharacterClassesResponse,
  type CharacterDetailsResponse,
  type GetSelectionRuleOptionsResponse,
} from "@starlights/api-client";
import { apiClient } from "@/lib/api-client";
import { saveUnlockToken } from "@/lib/player";

export interface BuilderChoice {
  ruleId: string;
  registrationId: string;
  section: string;
  depth: number;
  name: string;
  type: string;
  parentName: string;
  parentType: string;
  parentElementId: string;
  level: number;
  slot: number;
  slots: number;
  selected: { elementId: string; name: string; source: string | null } | null;
}

export interface PlayerSummary {
  name: string;
  characters: number;
  locked: boolean;
}

export interface CharacterListItem {
  characterId: string;
  name: string;
  portraitUrl?: string | null;
  level: number;
  build: string;
  playerName: string;
}

const keys = {
  choices: (id: string) => ["builder", id, "choices"] as const,
  options: (id: string, ruleId: string) => ["builder", id, "options", ruleId] as const,
  details: (id: string) => ["builder", id, "details"] as const,
  classes: (id: string) => ["builder", id, "classes"] as const,
  character: (id: string) => ["builder", id] as const,
  players: ["players"] as const,
  characters: (player: string | null) => ["characters", "by-player", player ?? "*"] as const,
};

/**
 * The character's choices. Picks are processed in the background, so while the server reports pending work the
 * query keeps polling, and after every change it is refreshed a few more times (level changes and removals
 * re-process existing registrations without flagging them as pending).
 */
export function useBuilderChoices(characterId: string) {
  return useQuery({
    queryKey: keys.choices(characterId),
    queryFn: () => apiClient.get<{ choices: BuilderChoice[]; pending: boolean }>(`/api/characters/${characterId}/builder/choices`),
    refetchInterval: (query) => (query.state.data?.pending ? 400 : false),
    staleTime: 0,
  });
}

export function refreshCharacter(qc: QueryClient, characterId: string) {
  const refresh = () => qc.invalidateQueries({ queryKey: keys.character(characterId) }).catch(() => {});
  refresh();
  for (const delay of [600, 1500, 3000]) setTimeout(refresh, delay);
  // the sheet data (abilities, skills, statistics) is cached under the upstream character keys
  setTimeout(() => qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {}), 1500);
}

export function useChoiceOptions(characterId: string, ruleId: string, enabled: boolean) {
  return useQuery<GetSelectionRuleOptionsResponse>({
    queryKey: keys.options(characterId, ruleId),
    queryFn: () => getSelectionRuleOptions(apiClient, characterId, ruleId),
    enabled,
    staleTime: 10_000,
  });
}

export function usePickChoice(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ choice, elementId }: { choice: BuilderChoice; elementId: string }) =>
      registerSelection(apiClient, characterId, choice.ruleId, { parentRegistration: choice.registrationId, elementId }),
    onSettled: () => refreshCharacter(qc, characterId),
  });
}

export function useClearChoice(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choice: BuilderChoice) =>
      unregisterSelection(apiClient, characterId, choice.ruleId, {
        parentRegistration: choice.registrationId,
        elementId: choice.selected!.elementId,
      }),
    onSettled: () => refreshCharacter(qc, characterId),
  });
}

export function useCharacterHeader(characterId: string) {
  return useQuery<CharacterDetailsResponse & { character: { playerName?: string } }>({
    queryKey: keys.details(characterId),
    queryFn: () => getCharacterDetails(apiClient, characterId),
  });
}

export function useCharacterClassList(characterId: string) {
  return useQuery<CharacterClassesResponse>({
    queryKey: keys.classes(characterId),
    queryFn: () => getCharacterClasses(apiClient, characterId),
  });
}

export function useSetClassLevel(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterClassId, newLevel }: { characterClassId: string; newLevel: number }) =>
      updateClassLevel(apiClient, characterId, characterClassId, { newLevel }),
    onSettled: () => refreshCharacter(qc, characterId),
  });
}

export function useAssignPlayer(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerName: string) => apiClient.put<{ playerName: string }, void>(`/api/characters/${characterId}/player`, { playerName }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.details(characterId) }).catch(() => {});
      qc.invalidateQueries({ queryKey: keys.players }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {});
    },
  });
}

export function usePlayers() {
  return useQuery({
    queryKey: keys.players,
    queryFn: () => apiClient.get<{ players: PlayerSummary[] }>("/api/characters/players"),
  });
}

/** The characters of one player, or everyone's when player is null. */
export function useCharacterList(player: string | null) {
  return useQuery({
    queryKey: keys.characters(player),
    queryFn: () =>
      apiClient.get<{ characters: CharacterListItem[] }>(player ? `/api/characters?player=${encodeURIComponent(player)}` : "/api/characters"),
  });
}

/** Checks a locked player's password; on success the unlock token is remembered by this browser. */
export function useUnlockPlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, password }: { name: string; password: string }) =>
      apiClient.post<{ name: string; password: string }, { name: string; token: string }>("/api/characters/players/unlock", { name, password }),
    onSuccess: (result) => {
      saveUnlockToken(result.name, result.token);
      qc.invalidateQueries({ queryKey: keys.players }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {});
    },
  });
}

/** Sets, changes or (empty password) removes a player's password. */
export function useSetPlayerPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, password }: { name: string; password: string }) =>
      apiClient.put<{ name: string; password: string }, { name: string; token: string }>("/api/characters/players/password", { name, password }),
    onSuccess: (result) => {
      if (result.token) saveUnlockToken(result.name, result.token);
      qc.invalidateQueries({ queryKey: keys.players }).catch(() => {});
    },
  });
}

export function useUploadPortrait(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dataUrl: string) =>
      apiClient.post<{ data: string }, { portraitUrl: string }>(`/api/characters/${characterId}/portrait`, { data: dataUrl }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.details(characterId) }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {});
    },
  });
}

export function useRemovePortrait(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<void>(`/api/characters/${characterId}/portrait`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.details(characterId) }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {});
    },
  });
}
