import { createContext, useContext, useState, type ReactNode } from "react";

// There are no accounts: each browser remembers who is playing, and characters are filed under that name.
// Players can lock their characters with a password; unlocking stores a token here that goes with every request.
const STORAGE_KEY = "starlights.player";
const TOKENS_KEY = "starlights.player-tokens";

function readStoredPlayer(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeTokens(tokens: Record<string, string>) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // private mode etc.: the unlock just lasts until the page is reloaded
  }
}

/** Remembers the unlock token of a password-locked player. */
export function saveUnlockToken(player: string, token: string) {
  writeTokens({ ...readTokens(), [player.toLowerCase()]: token });
}

export function forgetUnlockToken(player: string) {
  const tokens = readTokens();
  delete tokens[player.toLowerCase()];
  writeTokens(tokens);
}

const ADMIN = "*admin*";

/** Whether this browser unlocked the master admin password. */
export function isAdmin(): boolean {
  return ADMIN in readTokens();
}

export function saveAdminToken(token: string) {
  writeTokens({ ...readTokens(), [ADMIN]: token });
}

export function forgetAdminToken() {
  forgetUnlockToken(ADMIN);
}

/** The X-Player-Token header value: every token this browser holds (without the DM's, to see what players see). */
export function unlockTokenHeader(includeAdmin = true): string {
  return Object.entries(readTokens())
    // seeing as a player leaves out the admin's token and every campaign DM token
    .filter(([name]) => includeAdmin || (name !== ADMIN && !name.startsWith("#dm:")))
    .map(([, token]) => token)
    .join(",");
}

const campaignKey = (campaignId: string) => `#campaign:${campaignId}`;

/** Remembers the token a campaign's DM password gave (or its creation): this browser runs that campaign. */
export function saveCampaignDmToken(campaignId: string, token: string) {
  saveUnlockToken(`#dm:${campaignId}`, token);
}

/** Remembers the token a campaign's password gave. */
export function saveCampaignToken(campaignId: string, token: string) {
  saveUnlockToken(campaignKey(campaignId), token);
}

type PlayerContextValue = {
  player: string | null;
  setPlayer: (name: string | null) => void;
};

const PlayerContext = createContext<PlayerContextValue>({ player: null, setPlayer: () => {} });

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayerState] = useState<string | null>(readStoredPlayer);

  function setPlayer(name: string | null) {
    const value = name?.trim() || null;
    // switching away from a locked player locks it again on this browser
    if (player && value?.toLowerCase() !== player.toLowerCase()) forgetUnlockToken(player);
    setPlayerState(value);
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // private mode etc.: the choice just lasts for this visit
    }
  }

  return <PlayerContext.Provider value={{ player, setPlayer }}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}
