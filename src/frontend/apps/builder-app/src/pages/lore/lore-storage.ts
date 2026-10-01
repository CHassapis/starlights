/**
 * What the compendium remembers for whoever uses this browser: recently opened entries, pinned entries, and the
 * books they use ("my sources"). Kept per player name in this browser's storage (the app has no accounts), and
 * nothing breaks when storage is unavailable.
 */
import { useSyncExternalStore } from "react";

export interface EntryRef {
  category: string;
  key: string;
  name: string;
  source: string;
}

const PLAYER_KEY = "starlights.player";
const listeners = new Set<() => void>();

function storageKey(what: string): string {
  let player = "";
  try {
    player = localStorage.getItem(PLAYER_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  return `starlights.lore.${what}.${player.toLowerCase() || "anyone"}`;
}

function read<T>(what: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(what));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const cache = new Map<string, unknown>();
function write(what: string, value: unknown) {
  try {
    localStorage.setItem(storageKey(what), JSON.stringify(value));
  } catch {
    /* storage unavailable: kept for this visit only */
  }
  cache.set(storageKey(what), value);
  listeners.forEach((l) => l());
}

function useStored<T>(what: string, fallback: T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = () => {
        cache.delete(storageKey(what));
        l();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => {
      // per player: switching player shows that player's lists
      const k = storageKey(what);
      if (!cache.has(k)) cache.set(k, read(what, fallback));
      return cache.get(k) as T;
    },
  );
}

const same = (a: EntryRef, b: EntryRef) => a.category === b.category && a.key === b.key;

export function rememberRecent(ref: EntryRef) {
  const list = read<EntryRef[]>("recent", []).filter((r) => !same(r, ref));
  write("recent", [ref, ...list].slice(0, 30));
}

export function useRecent(): EntryRef[] {
  return useStored<EntryRef[]>("recent", []);
}

export function usePins(): EntryRef[] {
  return useStored<EntryRef[]>("pins", []);
}

export function togglePin(ref: EntryRef) {
  const list = read<EntryRef[]>("pins", []);
  write("pins", list.some((r) => same(r, ref)) ? list.filter((r) => !same(r, ref)) : [...list, ref].slice(-50));
}

export function isPinned(pins: EntryRef[], category: string, key: string): boolean {
  return pins.some((p) => p.category === category && p.key === key);
}

/** The books this player hides everywhere in the compendium (empty: none hidden). */
export function useHiddenSources(): string[] {
  return useStored<string[]>("hidden-sources", []);
}

export function setHiddenSources(sources: string[]) {
  write("hidden-sources", sources);
}
