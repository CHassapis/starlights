/**
 * The spells a wand, staff, rod or other magic item lets its holder cast, read from its text: which spells, how many
 * charges each costs, the level it is cast at, whether more charges cast it at a higher level, and the save DC or
 * attack bonus the item fixes (else the holder's own). The books word this many ways:
 *   2014 lists:   "cast one of the following spells … : burning hands (1 charge), fireball (3 charges)"
 *   2024 tables:  <tr><td><i>Fireball (level 5 version)</i></td><td>5</td></tr>
 *   one spell:    "1 or more" charges for one spell, its level for 1 charge, a level higher per additional charge
 *   (the level for 1 charge, one level higher per additional charge)
 *   free spells:  spells cast "at will" or "without using any charges"
 * Items whose spells are random (a d100 table) or not named ("cast its spell") are left to their text.
 */

export interface ItemSpellRef {
  /** the spell's name and element in the spell index */
  name: string;
  spellId: string;
  /** charges for the cheapest casting (0: free) */
  cost: number;
  /** the level it is cast at for that cost */
  level: number;
  /** each extra charge casts it one level higher, up to this many charges (null: no more than the charges left) */
  upcast: boolean;
  maxCost: number | null;
  /** the item's own save DC and spell attack bonus; null: the holder's */
  dc: number | null;
  attack: number | null;
  /** a bonus action to cast, when the item says so (else the spell's own casting time) */
  bonusAction: boolean;
}

export type FindSpell = (name: string) => { id: string; name: string; level: number } | undefined;

const WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, single: 1 };
const num = (s: string) => WORDS[s.toLowerCase()] ?? Number(s);
const text = (html: string) =>
  html
    .replace(/<\/td>\s*<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const LEVEL = /\b(\d)(?:st|nd|rd|th)[- ]level\b|\blevel (\d) (?:version|spell)\b/i;
const levelIn = (s: string) => {
  const m = s.match(LEVEL);
  return m ? Number(m[1] ?? m[2]) : null;
};
const dcIn = (s: string) => s.match(/\bsave DC (?:of )?(\d+)|\bDC ?(\d+)/i)?.slice(1).find(Boolean);
const attackIn = (s: string) => s.match(/([+-]\d+) to hit|spell attack (?:bonus|modifier) (?:of |is )?\+(\d+)/i)?.slice(1).find(Boolean);

export function itemSpells(html: string, find: FindSpell): ItemSpellRef[] {
  if (!/\bcast\b/i.test(html)) return [];
  const all = text(html);
  const tableSpells = /\bcast\b[^.]*\btable\b/i.test(all) && !/\bd100\b|\bpercentile\b/i.test(all);
  const ownDc = /\byour spell save DC\b/i.test(all);
  const ownAttack = /\byour spell attack (?:bonus|modifier)\b/i.test(all);
  const itemDc = ownDc ? undefined : dcIn(all);
  const itemAttack = ownAttack ? undefined : attackIn(all);

  const found = new Map<string, ItemSpellRef>();
  // paragraphs and table rows, each read on its own
  for (const block of html.split(/<\/p>|<\/tr>|<\/li>/i)) {
    const isRow = /<td/i.test(block);
    // a bulleted list under "cast one of the following spells:"
    const isItem = !isRow && /<li/i.test(block) && /\bcast\b[^.]*\bfollowing spells\b/i.test(all);
    const plain = text(block);
    if (isRow ? !tableSpells : !isItem && !/\bcast\b/i.test(plain)) continue;
    // the spells named in it: in italics (a property's heading, "Spells." or "Light.", is not one), else in plain words
    // after "cast (the)" or in a list ("…: banishment (4 charges), blink (3 charges)")
    let source = block;
    let candidates: { start: number; end: number; raw: string }[] = [...block.matchAll(/<(em|i)>([^<]+)<\/\1>/gi)]
      .filter((m) => !/\.\s*$/.test(m[2]) && !/<(?:b|strong)>\s*$/i.test(block.slice(0, m.index)))
      .map((m) => ({ start: m.index!, end: m.index! + m[0].length, raw: m[2] }))
      .filter((c) => find(spellName(c.raw)));
    if (candidates.length === 0 && !isRow) {
      source = plain;
      candidates = plainCandidates(plain, find);
    }
    const lone = candidates.length === 1 && !isRow && !isItem;
    candidates.forEach((c, i) => {
      const raw = c.raw.replace(/[’‘]/g, "'").trim();
      const spell = find(spellName(raw))!;
      // the sentence it is in: "cast dancing lights and light from the ring at will"
      const sentence = text(source.slice(Math.max(source.lastIndexOf(". ", c.start), 0), source.indexOf(". ", c.end) + 1 || source.length));
      // a spell the item changes or a spellbook holds, not one cast from it
      if (found.has(spell.id) || /\b(?:whenever|when) you cast\b|\bas if you (?:had )?cast\b|\bcontains? the following spells\b/i.test(sentence)) return;
      const after = text(source.slice(c.end, candidates[i + 1]?.start ?? source.length));
      // its parenthesis in a list, the next cell in a table, the rest of the paragraph for a lone spell
      const paren = [raw.match(/\(([^)]*)\)/)?.[1] ?? "", isRow ? after : (after.match(/^\(([^)]*)\)/)?.[1] ?? "")].join(" ");
      const own = lone ? `${paren} ${after}` : paren;
      const context = lone ? plain : own;

      let cost: number | null = null;
      if (/\bno charges?\b/i.test(paren) || (isRow && /^\|\s*0\b/.test(after))) cost = 0;
      else if (/without (?:using|expending) any (?:of its )?charges|\bat will\b/i.test(sentence)) cost = 0;
      else {
        const n = paren.match(/\b(\d+|one|two|three|four|five|six|seven) charges?\b/i)?.[1] ?? (isRow ? after.match(/^\|\s*(\d+)/)?.[1] : undefined);
        if (n) cost = num(n);
      }
      const perLevel = /\bper (?:spell )?level\b/i.test(own);
      const extra = perLevel || (lone && /\badditional charge|\b1 or more\b|\bno more than \d+ charges\b/i.test(plain));
      if (cost === null) {
        if (!isRow && !isItem && !/\bcharge/i.test(plain)) cost = 0;
        else if (lone && /\b1 or more\b|\bno more than\b/i.test(plain)) cost = 1;
        else {
          const n = (lone ? plain : all).match(/\bexpend(?:s|ing)? (?:(?:the|its|of its|of the \w+'s) )?(\d+|a|one|a single|two|three)? ?(?:of (?:its|the \w+'s) )?charges?\b/i)?.[1];
          cost = n ? num(n) : 1;
        }
      }
      // a cantrip has no level ("cast at 5th level" means its damage); "1 charge per spell level" starts at the spell's
      const level = spell.level === 0 ? 0 : perLevel ? Math.max(1, spell.level) : (levelIn(own) ?? spell.level);
      let maxCost: number | null = null;
      if (extra) {
        const most = context.match(/\bno more than (\d+) charges\b|\bmaximum (?:of )?(\d+)\b/i);
        const upTo = context.match(/\bup to (\d)(?:st|nd|rd|th)\b/i)?.[1];
        maxCost = most ? Number(most[1] ?? most[2]) : upTo ? cost + Number(upTo) - level : null;
      }
      const dc = dcIn(own) ?? itemDc;
      const attack = attackIn(own) ?? itemAttack;
      found.set(spell.id, {
        name: spell.name,
        spellId: spell.id,
        cost,
        level,
        upcast: extra,
        maxCost,
        dc: dc && !ownDc ? Number(dc) : null,
        attack: attack && !ownAttack ? Number(attack) : null,
        bonusAction: /\bas a bonus action\b|\bbonus action to cast\b/i.test(sentence),
      });
    });
  }
  return [...found.values()];
}

/** "Fireball (level 5 version)", "the fireball spell" -> "Fireball", "fireball" */
const spellName = (raw: string) =>
  raw
    .replace(/[’‘]/g, "'")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+spell$/i, "")
    .trim();

/** Spell names in plain words: the longest run of up to six words after "cast (the)" or a list's ":", "," or "or". */
function plainCandidates(plain: string, find: FindSpell): { start: number; end: number; raw: string }[] {
  const out: { start: number; end: number; raw: string }[] = [];
  let from = 0;
  for (const m of plain.matchAll(/\bcast (?:the |either )?|[:,;] (?:or |and )?|\b(?:or|and) /gi)) {
    const start = m.index! + m[0].length;
    if (start < from) continue;
    const words = plain.slice(start).match(/^[A-Za-z'/-]+(?: [A-Za-z'/-]+){0,5}/)?.[0].split(" ") ?? [];
    for (let n = words.length; n > 0; n--) {
      const raw = words.slice(0, n).join(" ");
      if (find(raw)) {
        out.push({ start, end: start + raw.length, raw });
        from = start + raw.length;
        break;
      }
    }
  }
  return out;
}
