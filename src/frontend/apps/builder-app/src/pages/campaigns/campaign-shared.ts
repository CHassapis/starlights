/** Names and styles the campaign pages share. */
import type { EntryKind } from "@/lib/api/campaigns";
import { homebrewSources, useSources } from "@/lib/api/sources";

export const KIND_NAMES: Record<EntryKind, string> = {
  session: "Session",
  npc: "NPC",
  encounter: "Encounter",
  place: "Place",
  faction: "Faction",
  item: "Item",
  handout: "Handout",
  quest: "Quest",
  ledger: "Gold line",
  map: "Map",
  magicitem: "Magic item",
  note: "Note",
};

/** The codex: everything with a picture and a status that is not an NPC, encounter, map or magic item. */
export const CODEX_KINDS: EntryKind[] = ["place", "faction", "item", "handout"];

export const textareaClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The books a campaign's item pickers leave out: the homebrew ones, unless the DM switched on "Use homebrew". */
export function useCampaignRestricted(useHomebrew: boolean | undefined): string[] {
  const { data } = useSources();
  return useHomebrew || !data ? [] : homebrewSources(data.sources);
}

/** Where a magic item is when no party member carries it (the DM sets it; who carries it is worked out). */
export const WHEREABOUTS: { value: string; label: string }[] = [
  { value: "", label: "Not found yet" },
  { value: "stash", label: "In the party stash" },
  { value: "sold", label: "Sold or given away" },
  { value: "used", label: "Used up or destroyed" },
  { value: "lost", label: "Lost" },
];

export const whereaboutsLabel = (value: unknown) => WHEREABOUTS.find((w) => w.value === (typeof value === "string" ? value : ""))?.label ?? WHEREABOUTS[0].label;
