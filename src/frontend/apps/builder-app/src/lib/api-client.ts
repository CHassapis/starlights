import { createHttpClient } from "@starlights/api-client";
import { playerNameHeader, unlockTokenHeader } from "@/lib/player";

/**
 * Singleton HTTP client instance for builder-app.
 *
 * Reads the backend base URL from the VITE_API_BASE env variable at build/dev time.
 * To inject auth headers (e.g. a Bearer token), add a getHeaders callback:
 *
 * @example
 *   createHttpClient({
 *     baseUrl: ...,
 *     getHeaders: () => ({ Authorization: `Bearer ${getToken()}` }),
 *   })
 */
export const apiClient = createHttpClient({
  baseUrl: import.meta.env.VITE_API_BASE ?? "https://localhost:7246",
  // unlock tokens of password-locked players (see lib/player.tsx)
  getHeaders: (): Record<string, string> => {
    const tokens = unlockTokenHeader();
    return { ...(tokens ? { "X-Player-Token": tokens } : {}), ...playerNameHeader() };
  },
});
