/**
 * Campaign text as the DM writes or pastes it (often from a prep PDF): plain lines, read into blocks so they show
 * with real structure. Nothing is written in a markup language on purpose; the conventions are the ones prep
 * documents already use:
 *   heading     a line in capitals ("CASTLE RAVENLOFT", "DM EYES ONLY"), or "# Heading"
 *   list        lines starting "- ", "• " or "* "; numbered "1. " / "1) "
 *   table       two or more lines of cells separated by " | " ("# | SCENE | WHAT HAPPENS")
 *   paragraph   anything else; consecutive lines stay one paragraph with their line breaks
 * Inline: **bold**, a leading label in capitals ("WHO: …", "READ ALOUD …") and a stat block's trait name
 * ("Spider Climb. Walls and …") are set in bold.
 */

export type Inline = { text: string; bold?: boolean };

export type Block =
  | { kind: "heading"; text: string; id: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: string[] | null; rows: string[][] }
  | { kind: "paragraph"; lines: Inline[][] };

const BULLET = /^\s*(?:[-•*])\s+/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+/;
const cells = (line: string) => line.split(/\s+\|\s+|^\|\s*|\s*\|$/).map((c) => c.trim());
const isRow = (line: string) => (line.match(/ \| /g)?.length ?? 0) >= 1 && cells(line).filter(Boolean).length >= 2;

/** A heading: "# …", or a short line with letters and no lower-case letters ("SESSION PREP IV · NEXT SESSION"). */
export function headingText(line: string): string | null {
  const t = line.trim();
  if (isRow(t)) return null;
  const hashed = t.match(/^#{1,4}\s+(.+)$/);
  if (hashed) return hashed[1].trim();
  if (t.length < 4 || t.length > 90 || /[a-z]/.test(t) || !/[A-Z]{3,}/.test(t) || isRow(t) || BULLET.test(t)) return null;
  // a line of numbers or a stat line ("STR DEX CON") is not a heading
  if (/^(STR|DEX|CON|INT|WIS|CHA)(\s+(STR|DEX|CON|INT|WIS|CHA))+$/.test(t)) return null;
  return t;
}

/** Bold where the text marks it: **…**, a leading LABEL: in capitals, a stat block's "Trait Name." */
export function inline(line: string): Inline[] {
  const out: Inline[] = [];
  let rest = line;
  const label = rest.match(/^((?:[A-Z][A-Z'’&/ -]{1,28}[A-Z])(?::|(?= [A-Z(“"'])))\s?/);
  // "WHO:" with its colon; without one only a label of two or more words ("READ ALOUD …"), not "AC 15" or "HP 120"
  if (label && /[A-Z]{2,}/.test(label[1]) && (label[1].endsWith(":") || label[1].includes(" "))) {
    out.push({ text: label[0], bold: true });
    rest = rest.slice(label[0].length);
  } else {
    const trait = rest.match(/^([A-Z][\w'’()/-]*(?: [\w'’()/-]+){0,5})\. (?=[A-Z0-9“"(])/);
    if (trait && trait[1].split(" ").every((w, i) => i === 0 || /^[A-Z(]/.test(w) || /^(of|the|and|or|to|in|on|a|an|with|vs)$/.test(w)) && trait[1].length <= 45) {
      out.push({ text: `${trait[1]}.`, bold: true }, { text: " " });
      rest = rest.slice(trait[0].length);
    }
  }
  const parts = rest.split(/\*\*(.+?)\*\*/g);
  parts.forEach((p, i) => p && out.push(i % 2 ? { text: p, bold: true } : { text: p }));
  return out;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "section";

export function parseRichText(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = headingText(line);
    if (heading) {
      const base = slug(heading);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      blocks.push({ kind: "heading", text: heading, id: n > 1 ? `${base}-${n}` : base });
      i++;
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isRow(lines[i + 1])) {
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]).filter((c, j, all) => c || (j > 0 && j < all.length - 1)));
      // a first row in capitals (or of short labels) is the header
      const first = rows[0];
      const header = first.every((c) => !/[a-z]/.test(c)) || first.every((c) => c.length <= 14) ? first : null;
      blocks.push({ kind: "table", header, rows: header ? rows.slice(1) : rows });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const marker = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i++].replace(marker, "");
        // a wrapped item continues on the next indented line
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(inline(item));
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && !headingText(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !(isRow(lines[i]) && i + 1 < lines.length && isRow(lines[i + 1]))) {
      para.push(inline(lines[i++].trim()));
    }
    blocks.push({ kind: "paragraph", lines: para });
  }
  return blocks;
}
