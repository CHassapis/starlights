import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/** A piece of setting lore from the 5etools data, its text as simple HTML. */
export interface LoreEntry {
  name: string;
  source: string;
  group: string;
  html: string;
}

export function useOrganizations() {
  return useQuery({
    queryKey: ["lore", "organizations"],
    queryFn: () => apiClient.get<{ organizations: LoreEntry[] }>("/api/elements/lore/organizations"),
    staleTime: Infinity,
  });
}

const key = (name: string) => name.trim().toLowerCase().replace(/^the\s+/, "").replace(/’/g, "'");

/** The known organization a typed name refers to ("The Harpers" and "harpers" both find the Harpers). */
export function findOrganization(organizations: LoreEntry[] | undefined, name: string | undefined): LoreEntry | undefined {
  if (!name?.trim()) return undefined;
  return organizations?.find((o) => key(o.name) === key(name));
}
