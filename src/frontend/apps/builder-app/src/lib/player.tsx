import { createContext, useContext, useState, type ReactNode } from "react";

// There are no accounts: each browser remembers who is playing, and characters are filed under that name.
const STORAGE_KEY = "starlights.player";

function readStoredPlayer(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
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
