/**
 * The Compendium of Lore's categories: their names, and which {@tag} points into which category. A category is
 * "built" once the ingest script writes it (meta.categories lists those); tags into categories that are not built
 * yet show as plain text.
 */

export interface CategoryInfo {
  id: string;
  label: string;
  /** one entry, for "1 spell" */
  singular: string;
  blurb: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: "spells", label: "Spells", singular: "spell", blurb: "Every spell, by level, school and class." },
  { id: "bestiary", label: "Bestiary", singular: "creature", blurb: "Monsters and NPCs with their stat blocks and lore." },
  { id: "items", label: "Items", singular: "item", blurb: "Magic items, weapons, armor and gear." },
  { id: "classes", label: "Classes", singular: "class", blurb: "Classes and their subclasses, level by level." },
  { id: "species", label: "Species", singular: "species", blurb: "Species and races, with their lore." },
  { id: "backgrounds", label: "Backgrounds", singular: "background", blurb: "Backgrounds and what they grant." },
  { id: "feats", label: "Feats", singular: "feat", blurb: "Feats, with prerequisites." },
  { id: "optionalfeatures", label: "Class options", singular: "option", blurb: "Invocations, maneuvers, infusions, metamagic and more." },
  { id: "conditions", label: "Conditions", singular: "condition", blurb: "Conditions, diseases and statuses." },
  { id: "rules", label: "Rules", singular: "rule", blurb: "Variant and optional rules." },
  { id: "actions", label: "Actions", singular: "action", blurb: "What you can do on your turn." },
  { id: "deities", label: "Deities", singular: "deity", blurb: "Gods of every pantheon." },
  { id: "languages", label: "Languages", singular: "language", blurb: "Languages, their speakers and scripts." },
  { id: "rewards", label: "Supernatural gifts", singular: "gift", blurb: "Boons, blessings, charms, cults and other gifts." },
  { id: "objects", label: "Objects", singular: "object", blurb: "Siege weapons and other objects." },
  { id: "traps", label: "Traps & hazards", singular: "trap or hazard", blurb: "Traps and environmental hazards." },
  { id: "vehicles", label: "Vehicles", singular: "vehicle", blurb: "Ships, infernal war machines and more." },
  { id: "tables", label: "Tables", singular: "table", blurb: "Random and reference tables." },
  { id: "decks", label: "Decks", singular: "deck", blurb: "The Deck of Many Things and other decks." },
  { id: "bastions", label: "Bastions", singular: "facility", blurb: "Bastion facilities." },
  { id: "books", label: "Books", singular: "book", blurb: "Rulebooks and supplements to read." },
  { id: "adventures", label: "Adventures", singular: "adventure", blurb: "Adventures to read and run." },
];

export const CATEGORY_BY_ID: Record<string, CategoryInfo> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** Which category each reference tag points into. */
export const TAG_CATEGORY: Record<string, string> = {
  spell: "spells",
  creature: "bestiary",
  item: "items",
  class: "classes",
  race: "species",
  background: "backgrounds",
  feat: "feats",
  optfeature: "optionalfeatures",
  condition: "conditions",
  disease: "conditions",
  status: "conditions",
  variantrule: "rules",
  action: "actions",
  deity: "deities",
  language: "languages",
  reward: "rewards",
  boon: "rewards",
  cult: "rewards",
  object: "objects",
  trap: "traps",
  hazard: "traps",
  vehicle: "vehicles",
  table: "tables",
  deck: "decks",
  facility: "bastions",
};
