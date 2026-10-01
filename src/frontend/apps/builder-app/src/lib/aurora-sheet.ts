import fontkit from "@pdf-lib/fontkit";
import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts, rgb, type Color, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";
import type { SheetData, SheetFeature, SheetSpell } from "@/lib/api/sheet";
import { spellLevelLine } from "@/lib/api/sheet";

/*
 * The character sheet as Aurora Builder makes it: Aurora's own sheet templates (taken from its installer, served by
 * /api/sheet-templates) are placed page by page and the character is written into their boxes, at the positions
 * and sizes of the templates' form fields. Long texts (features, traits, spell descriptions) are laid out like
 * Aurora does, with bold-italic run-in headings; spellcasting pages are stacked from Aurora's strips and spells
 * get Aurora's cards, nine to a page.
 */

const TEMPLATE_BASE = `${import.meta.env.VITE_API_BASE ?? ""}/api/sheet-templates/`;
const assets = new Map<string, Promise<ArrayBuffer>>();

function asset(name: string): Promise<ArrayBuffer> {
  if (!assets.has(name)) {
    assets.set(
      name,
      fetch(TEMPLATE_BASE + encodeURIComponent(name)).then((r) => {
        if (!r.ok) throw new Error(`The sheet template "${name}" is not installed on the server.`);
        return r.arrayBuffer();
      }),
    );
    assets.get(name)!.catch(() => assets.delete(name));
  }
  return assets.get(name)!;
}

interface Fonts {
  field: PDFFont;
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  dingbats: PDFFont;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FieldBox extends Box {
  checkbox?: boolean;
  size: number;
  align: 0 | 1 | 2;
  multiline: boolean;
  color: Color;
}

interface Template {
  page: PDFEmbeddedPage;
  fields: Map<string, FieldBox[]>;
}

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GRAY = rgb(0.45, 0.45, 0.45);

/** A run of text in one font; paragraphs are lists of runs. */
interface Run {
  text: string;
  font: keyof Omit<Fonts, "dingbats" | "field">;
}
type Paragraph = Run[];

class SheetBuilder {
  private readonly templates = new Map<string, Promise<Template>>();
  private readonly partials = new Map<string, Promise<PDFEmbeddedPage>>();

  readonly doc: PDFDocument;
  readonly fonts: Fonts;

  private constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
  }

  static async create(): Promise<SheetBuilder> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle("Character Sheet");
    doc.setCreator("Starlights");
    const [field, regular, bold, italic, boldItalic] = await Promise.all(
      ["MyriadPro-Regular.ttf", "Carlito-Regular-Latin.ttf", "Carlito-Bold-Latin.ttf", "Carlito-Italic-Latin.ttf", "Carlito-BoldItalic-Latin.ttf"].map(asset),
    );
    // Carlito (Calibri's metric twin) cut down to Latin without ligatures beforehand (fonttools): pdf-lib's own
    // subsetting garbles it, and its "ti" ligature came out as a gap
    const plain = { features: { liga: false, clig: false, dlig: false, calt: false, rlig: false } };
    const fonts: Fonts = {
      field: await doc.embedFont(field),
      regular: await doc.embedFont(regular, plain),
      bold: await doc.embedFont(bold, plain),
      italic: await doc.embedFont(italic, plain),
      boldItalic: await doc.embedFont(boldItalic, plain),
      dingbats: await doc.embedFont(StandardFonts.ZapfDingbats),
    };
    return new SheetBuilder(doc, fonts);
  }

  /** A full-page template: the page drawing plus where its form fields are. */
  template(name: string): Promise<Template> {
    if (!this.templates.has(name)) {
      this.templates.set(
        name,
        (async () => {
          const bytes = await asset(name);
          const [page] = await this.doc.embedPdf(bytes, [0]);
          const source = await PDFDocument.load(bytes);
          const fields = new Map<string, FieldBox[]>();
          for (const field of source.getForm().getFields()) {
            const da = field.acroField.getDefaultAppearance() ?? "";
            const size = Number(da.match(/([\d.]+)\s+Tf/)?.[1] ?? 0);
            const gray = da.match(/([\d.]+)\s+g\b/);
            const color = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
            for (const widget of field.acroField.getWidgets()) {
              const r = widget.getRectangle();
              const box: FieldBox = {
                x: Math.min(r.x, r.x + r.width),
                y: Math.min(r.y, r.y + r.height),
                w: Math.abs(r.width),
                h: Math.abs(r.height),
                size,
                align: (field instanceof PDFTextField ? field.acroField.getQuadding() ?? 0 : 0) as 0 | 1 | 2,
                multiline: field instanceof PDFTextField && field.isMultiline(),
                color: color ? rgb(+color[1], +color[2], +color[3]) : gray ? rgb(+gray[1], +gray[1], +gray[1]) : BLACK,
              };
              if (field instanceof PDFCheckBox) {
                box.size = 0;
                box.checkbox = true;
              }
              fields.set(field.getName(), [...(fields.get(field.getName()) ?? []), box]);
            }
          }
          return { page, fields };
        })(),
      );
    }
    return this.templates.get(name)!;
  }

  /** A strip or card template, placed at a position. */
  partial(name: string): Promise<PDFEmbeddedPage> {
    if (!this.partials.has(name)) {
      this.partials.set(
        name,
        asset(name).then(async (bytes) => (await this.doc.embedPdf(bytes, [0]))[0]),
      );
    }
    return this.partials.get(name)!;
  }

  async page(templateName: string): Promise<{ page: PDFPage; fields: Map<string, FieldBox[]> }> {
    const template = await this.template(templateName);
    const page = this.doc.addPage([612, 792]);
    page.drawPage(template.page, { x: 0, y: 0 });
    return { page, fields: template.fields };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// text

/** Characters the fonts cannot show or that break the layout. */
const LIGATURES: Record<string, string> = { "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st" };

function clean(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‍﻿]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "");
}

function widthOf(text: string, font: PDFFont, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** One line of text in a field box, like a PDF viewer shows a filled-in form field. */
function drawField(page: PDFPage, box: FieldBox, value: string | number | null | undefined, fonts: Fonts) {
  const font = fonts.field;
  const raw = clean(value === null || value === undefined ? "" : String(value));
  if (box.multiline) {
    drawParagraphs(page, box, textParagraphs(raw), { ...fonts, regular: font }, { size: box.size || 8, minSize: 4, color: box.color });
    return;
  }
  const text = raw.replace(/\n+/g, " ").trim();
  if (!text) return;
  // size 0 means "fit the box", as in the form field definition
  let size = box.size || Math.min(12, (box.h - 2) / 1.05);
  while (size > 4 && widthOf(text, font, size) > box.w - 4) size -= 0.25;
  const width = widthOf(text, font, size);
  const x = box.align === 1 ? box.x + (box.w - width) / 2 : box.align === 2 ? box.x + box.w - 2 - width : box.x + 2;
  const capHeight = font.heightAtSize(size, { descender: false }) * 0.9;
  const y = box.y + (box.h - capHeight) / 2;
  page.drawText(text, { x, y, size, font, color: box.color });
}

function textParagraphs(text: string): Paragraph[] {
  return clean(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [{ text: line, font: "regular" as const }]);
}

interface LayoutOptions {
  size: number;
  minSize: number;
  color?: Color;
  paragraphGap?: number;
  lineHeight?: number;
}

interface Placed {
  text: string;
  font: PDFFont;
  x: number;
}

/** Word-wraps paragraphs of runs to a width; returns the lines of placed words. */
function wrap(paragraphs: Paragraph[], fonts: Fonts, width: number, size: number): Placed[][][] {
  return paragraphs.map((paragraph) => {
    const lines: Placed[][] = [];
    let line: Placed[] = [];
    let x = 0;
    for (const run of paragraph) {
      const font = fonts[run.font];
      const words = run.text.split(/(\s+)/).filter((w) => w.length > 0);
      for (const word of words) {
        const isSpace = /^\s+$/.test(word);
        const w = widthOf(isSpace ? " " : word, font, size);
        if (isSpace) {
          if (line.length > 0) x += w;
          continue;
        }
        if (x + w > width && line.length > 0) {
          lines.push(line);
          line = [];
          x = 0;
        }
        line.push({ text: word, font, x });
        x += w;
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  });
}

/**
 * Lays paragraphs out in a box, shrinking the text until it fits (down to minSize; what still does not fit is
 * cut off with an ellipsis). Returns the paragraphs that did not fit, if any.
 */
function drawParagraphs(page: PDFPage, box: Box, paragraphs: Paragraph[], fonts: Fonts, options: LayoutOptions): Paragraph[] {
  if (paragraphs.length === 0) return [];
  const pad = 2;
  const width = box.w - pad * 2;
  const heightFor = (size: number, laid: Placed[][][]) => {
    const lineHeight = size * (options.lineHeight ?? 1.18);
    const gap = options.paragraphGap ?? size * 0.45;
    return laid.reduce((h, lines) => h + lines.length * lineHeight, 0) + gap * Math.max(0, laid.length - 1);
  };

  let size = options.size;
  let laid = wrap(paragraphs, fonts, width, size);
  while (size > options.minSize && heightFor(size, laid) > box.h - pad * 2) {
    size = Math.max(options.minSize, size - 0.25);
    laid = wrap(paragraphs, fonts, width, size);
  }

  const lineHeight = size * (options.lineHeight ?? 1.18);
  const gap = options.paragraphGap ?? size * 0.45;
  let y = box.y + box.h - pad - size * 0.85;
  const bottom = box.y + pad;
  for (let p = 0; p < laid.length; p++) {
    for (const line of laid[p]) {
      if (y < bottom) return paragraphs.slice(p);
      for (const word of line) {
        page.drawText(word.text, { x: box.x + pad + word.x, y, size, font: word.font, color: options.color ?? BLACK });
      }
      y -= lineHeight;
    }
    y -= gap;
  }
  return [];
}

/** Aurora's feature style: "Title (usage). Text", the title in bold italic. */
function featureParagraphs(features: SheetFeature[]): Paragraph[] {
  return features.flatMap((f) => {
    const extra = [f.action, f.usage].filter(Boolean).join("—");
    const title = `${clean(f.title)}${extra ? ` (${clean(extra)})` : ""}.`;
    const [first, ...rest] = clean(f.text).split(/\n+/).map((t) => t.trim()).filter(Boolean);
    return [
      [
        { text: title, font: "boldItalic" as const },
        { text: first ? ` ${first}` : "", font: "regular" as const },
      ],
      ...rest.map((t) => [{ text: t, font: "regular" as const }]),
    ];
  });
}

/** Spell and item descriptions (Aurora HTML) as paragraphs of runs, keeping bold and italic. */
function htmlParagraphs(html: string): Paragraph[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const paragraphs: Paragraph[] = [];
  let current: Paragraph = [];
  const flush = () => {
    const text = current.map((r) => r.text).join("").trim();
    if (text) paragraphs.push(current);
    current = [];
  };
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = clean(node.textContent).replace(/\s+/g, " ");
      if (text) current.push({ text, font: bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular" });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    const block = ["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "br", "table", "ul", "ol"].includes(tag);
    if (block) flush();
    if (tag === "li") current.push({ text: "• ", font: "regular" });
    const b = bold || ["strong", "b", "h1", "h2", "h3", "h4", "h5", "h6", "th"].includes(tag);
    const i = italic || ["em", "i"].includes(tag);
    node.childNodes.forEach((child, index) => {
      if ((tag === "tr" && index > 0) || ((child as HTMLElement).tagName?.toLowerCase() === "td" && index > 0)) current.push({ text: " | ", font: "regular" });
      walk(child, b, i);
    });
    if (block) flush();
  };
  walk(doc.body.firstChild!, false, false);
  flush();
  return paragraphs;
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function field(fields: Map<string, FieldBox[]>, name: string, index = 0): FieldBox | undefined {
  return fields.get(name)?.[index];
}

/** A ticked checkbox, drawn like Aurora: a ZapfDingbats glyph centred in the box. */
function drawCheck(page: PDFPage, box: FieldBox | undefined, glyph: "cross" | "star" | "dot", fonts: Fonts, color: Color = BLACK) {
  if (!box) return;
  const char = glyph === "cross" ? "✘" : glyph === "star" ? "★" : "●";
  const size = glyph === "cross" ? 5.83 : glyph === "star" ? 4 : Math.min(7.59, box.h - 2);
  const width = widthOf(char, fonts.dingbats, size);
  page.drawText(char, { x: box.x + (box.w - width) / 2, y: box.y + (box.h - size * 0.7) / 2, size, font: fonts.dingbats, color });
}

// ---------------------------------------------------------------------------------------------------------------
// pages

const ABILITY_KEYS: Record<string, string> = { STR: "str", DEX: "dex", CON: "con", INT: "int", WIS: "wis", CHA: "cha" };
const skillKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The details page's one-line fields and checkboxes under Aurora's field names ("Yes" ticks a box), as Aurora fills
 * them; the comparison with Aurora's own sheets reads these too.
 */
export function detailsValues(data: SheetData): Record<string, string> {
  const v: Record<string, string> = {};
  const set = (name: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") v[name] = String(value);
  };
  const s = data.story;
  set("details_build", data.classLine);
  set("details_xp", s.experience);
  set("details_character_name", data.name);
  set("details_background", data.background);
  set("details_player", data.player);
  set("details_alignment", data.alignment);
  set("details_deity", data.deity);

  set("details_armor_class", data.armor.total);
  set("details_equipped_armor", data.armor.label);
  set("details_equipped_shield", data.armor.shield);
  if (data.armor.stealthDisadvantage) v.details_armor_stealth_disadvantage = "Yes";
  set("details_proficiency_bonus", sign(data.proficiencyBonus));
  for (const a of data.abilities) {
    const key = ABILITY_KEYS[a.abbreviation];
    set(`details_${key}_score`, a.calculatedScore);
    set(`details_${key}_modifier`, sign(a.calculatedModifier));
  }
  for (const save of data.saves) {
    const key = ABILITY_KEYS[save.abilityScoreAbbreviation];
    set(`details_${key}_save_total`, sign(save.calculatedBonus));
    if (save.proficiency !== "none") v[`details_${key}_save_proficiency`] = "Yes";
  }
  for (const skill of data.skills) {
    const key = skillKey(skill.name);
    set(`details_${key}_total`, sign(skill.calculatedBonus));
    if (skill.proficiency !== "none") v[`details_${key}_proficiency`] = "Yes";
    if (skill.proficiency === "expertise") v[`details_${key}_expertise`] = "Yes";
  }
  set("details_passive_perception_total", data.passivePerception);
  set("details_initiative", sign(data.initiative));

  const attacks = data.attacksPerAction;
  set("details_encounter_box", `${attacks} ${attacks === 1 ? "Attack" : "Attacks"} / Attack Action`);
  data.attacks.slice(0, 4).forEach((a, i) => {
    set(`details_attack${i + 1}_weapon`, a.name);
    set(`details_attack${i + 1}_range`, a.range);
    set(`details_attack${i + 1}_attack`, a.attack);
    set(`details_attack${i + 1}_damage`, a.damage);
    set(`details_attack${i + 1}_description`, a.description);
  });

  set("details_hp_max", data.hitPoints);
  set("details_hd", data.hitDice);
  set("details_speed_walking", `${data.speeds.walk}ft.`);
  set("details_speed_fly", `${data.speeds.fly}ft.`);
  set("details_speed_climb", `${data.speeds.climb}ft.`);
  set("details_speed_swim", `${data.speeds.swim}ft.`);
  set("details_vision", data.vision.join(", "));
  return v;
}

/** "Resistances. Necrotic, Radiant" and the like, as Aurora's resistances box lists them. */
export function defenseLines(data: SheetData): [string, string[]][] {
  const d = data.defenses;
  return ([["Resistances", d.resistances], ["Immunities", d.immunities], ["Vulnerabilities", d.vulnerabilities]] as [string, string[]][]).filter(([, list]) => list.length > 0);
}

/** Fills a page's one-line fields and ticks its checkboxes from a value map. */
function fillFields(page: PDFPage, fields: Map<string, FieldBox[]>, values: Record<string, string>, fonts: Fonts) {
  for (const [name, value] of Object.entries(values)) {
    const box = field(fields, name);
    if (!box) continue;
    if (box.checkbox) {
      // a checkbox: Aurora ticks proficiency with a cross, expertise with a star
      if (value === "Yes") drawCheck(page, box, name.endsWith("_expertise") ? "star" : "cross", fonts);
    } else {
      drawField(page, box, value, fonts);
    }
  }
}

async function detailsPage(b: SheetBuilder, data: SheetData) {
  const { page, fields } = await b.page("Page.details_2.pdf");
  fillFields(page, fields, detailsValues(data), b.fonts);

  // the text boxes Aurora fills with formatted text
  const box = (name: string) => field(fields, name);
  const resistances = box("details_resistances");
  if (resistances) {
    const lines = defenseLines(data).map(([title, list]): Paragraph => [
      { text: `${title}.`, font: "boldItalic" },
      { text: ` ${list.join(", ")}`, font: "regular" },
    ]);
    if (lines.length) drawParagraphs(page, resistances, lines, b.fonts, { size: 7, minSize: 4 });
  }
  const racial = box("details_additional_notes");
  if (racial) drawParagraphs(page, racial, featureParagraphs(data.speciesTraits), b.fonts, { size: 7, minSize: 4 });
  const features = box("details_features");
  if (features) drawParagraphs(page, features, featureParagraphs(data.features), b.fonts, { size: 7, minSize: 3.5 });
  const proficiencies = box("details_proficiencies_languages");
  if (proficiencies) {
    const line = (title: string, list: { name: string }[]): Paragraph | null =>
      list.length ? [{ text: `${title}.`, font: "boldItalic" }, { text: ` ${list.map((e) => e.name).join(", ")}`, font: "regular" }] : null;
    const p = data.proficiencySummary;
    const paragraphs = [
      line("Armor Proficiencies", p.armor),
      line("Weapon Proficiencies", p.weapons),
      line("Tool Proficiencies", p.tools),
      line("Languages", p.languages),
    ].filter((x): x is Paragraph => x !== null);
    drawParagraphs(page, proficiencies, paragraphs, b.fonts, { size: 7, minSize: 4 });
  }
}

/** A picture fitted into a box, centred, keeping its proportions. */
async function drawPicture(b: SheetBuilder, page: PDFPage, box: Box | undefined, url: string | null | undefined) {
  if (!box || !url) return;
  try {
    const jpeg = await toJpeg(url);
    const image = await b.doc.embedJpg(jpeg);
    const scale = Math.min((box.w - 4) / image.width, (box.h - 4) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h });
  } catch {
    // a picture that cannot be read is left out rather than failing the sheet
  }
}

/** Any browser-readable picture as JPEG bytes (pdf-lib takes JPEG and PNG only; uploads may be WebP). */
async function toJpeg(url: string): Promise<ArrayBuffer> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/jpeg", 0.9));
  return jpeg.arrayBuffer();
}

/** Returns the backstory text that did not fit, for the notes page. */
async function backgroundPage(b: SheetBuilder, data: SheetData): Promise<Paragraph[]> {
  const { page, fields } = await b.page("Page.background.pdf");
  const s = data.story;
  const f = (name: string, value: string | undefined) => {
    const box = field(fields, name);
    if (box) drawField(page, box, value, b.fonts);
  };
  f("background_character_name", data.name);
  f("background_gender", s.gender);
  f("background_age", s.age);
  f("background_height", s.height);
  f("background_weight", s.weight);
  f("background_eyes", s.eyes);
  f("background_skin", s.skin);
  f("background_hair", s.hair);
  f("background_organization_name", s.organization);
  f("background_trinket", s.trinket);

  const text = (name: string, value: string | undefined, size: number) => {
    const box = field(fields, name);
    return box ? drawParagraphs(page, box, textParagraphs(value ?? ""), b.fonts, { size, minSize: 5 }) : [];
  };
  text("background_allies", s.allies, 9);
  text("background_traits", s.traits, 7);
  text("background_ideals", s.ideals, 7);
  text("background_bonds", s.bonds, 7);
  text("background_flaws", s.flaws, 7);
  text("background_additional_features", [s.features, s.appearance].filter(Boolean).join("\n"), 7);
  const overflow = text("background_story", s.backstory, 7);

  if (data.backgroundFeature) {
    f("background_feature_name", data.backgroundFeature.title);
    const box = field(fields, "background_feature");
    if (box) drawParagraphs(page, box, textParagraphs(data.backgroundFeature.text), b.fonts, { size: 7, minSize: 4 });
  }

  await drawPicture(b, page, field(fields, "background_portrait_image"), data.portraitUrl);
  await drawPicture(b, page, field(fields, "background_organization_image"), s.organizationSymbol);
  return overflow;
}

/** The equipment page's lists and figures under Aurora's field names (list rows as name.0, name.1, …). */
export function equipmentValues(data: SheetData): Record<string, string> {
  const e = data.equipment;
  const v: Record<string, string> = {};
  const rows = (prefix: string, lines: { name: string; count: number; weight: string }[], max: number) =>
    lines.slice(0, max).forEach((l, i) => {
      v[`${prefix}_name.${i}`] = l.name;
      v[`${prefix}_count.${i}`] = String(l.count);
      v[`${prefix}_weight.${i}`] = l.weight;
    });
  rows("equipment_page_gear", e.gear, 40);
  rows("equipment_page_magic_gear", e.magicGear, 20);
  rows("equipment_page_valuable", e.valuables, 10);
  e.storage.forEach((box, i) => {
    v[`equipment_page_vehicle_${i + 1}_name`] = box.name;
    rows(`equipment_page_vehicle_${i + 1}_cargo`, box.items, 10);
  });
  for (const coin of ["cp", "sp", "ep", "gp", "pp"] as const) v[`equipment_page_coins_${coin}`] = String(e.coins[coin]);
  v.equipment_page_attunement_current = String(e.attuned);
  v.equipment_page_attunement_max = String(e.attunementMax);
  v.equipment_page_weight_carried = `${e.carried} lb`;
  v.equipment_page_weight_capacity = `${e.capacity} lb`;
  v.equipment_page_weight_drag = `${e.drag} lb`;
  return v;
}

async function equipmentPage(b: SheetBuilder, data: SheetData) {
  const { page, fields } = await b.page("Aurora.Pages.equipment_page.pdf");
  const values = equipmentValues(data);
  // list rows: every widget of a list field is one row, in order
  for (const [name, value] of Object.entries(values)) {
    const m = name.match(/^(.*)\.(\d+)$/);
    const box = m ? (fields.get(m[1])?.[Number(m[2])] ?? fields.get(name)?.[0]) : field(fields, name);
    if (box) drawField(page, box, value, b.fonts);
  }

  const e = data.equipment;
  const text = (name: string, paragraphs: Paragraph[], size = 7) => {
    const box = field(fields, name);
    if (box && paragraphs.length) drawParagraphs(page, box, paragraphs, b.fonts, { size, minSize: 4 });
  };
  // the magic items' descriptions, each led by its name like a feature
  text(
    "equipment_page_magic_items",
    e.descriptions.flatMap((d) => {
      const [first, ...rest] = htmlParagraphs(d.html);
      return [[{ text: `${clean(d.title)}.`, font: "boldItalic" as const }, ...(first ?? []).map((r, i) => (i === 0 ? { ...r, text: ` ${r.text}` } : r))], ...rest];
    }),
  );
  text("equipment_page_additional_treasure", textParagraphs(e.treasure));
  text("equipment_page_quest_items", textParagraphs(e.questItems));
}

async function notesPage(b: SheetBuilder, data: SheetData, backstoryOverflow: Paragraph[]) {
  const notes = [...backstoryOverflow, ...textParagraphs(data.story.notes ?? "")];
  if (notes.length === 0) return;
  const { page, fields } = await b.page("Aurora.Pages.notes_page.pdf");
  const left = field(fields, "notes_page_left");
  const right = field(fields, "notes_page_right");
  let rest = left ? drawParagraphs(page, left, notes, b.fonts, { size: 7, minSize: 7 }) : notes;
  if (right && rest.length) rest = drawParagraphs(page, right, rest, b.fonts, { size: 7, minSize: 7 });
}

// spellcasting pages: a header strip, then per spell level a top strip (the level's label, first row), middle
// strips and a bottom strip (last row); spells fill the rows left to right, the first cell being the label
const SPELL_COLUMNS = [46, 235, 424];
const ROW = 12;

interface SpellList {
  title: string;
  ability: string;
  attack: string;
  save: string;
  prepare: string;
  levels: { level: number; slots: number; spells: { name: string; prepared: boolean }[] }[];
}

function spellLists(data: SheetData): SpellList[] {
  return data.spellPages.map((p) => ({ ...p, levels: p.levels.map((l) => ({ ...l, spells: l.spells })) }));
}

async function spellcastingPages(b: SheetBuilder, data: SheetData) {
  for (const list of spellLists(data)) {
    let y = 0;
    const header = await b.partial("Partial.Spellcasting.red_spells_header.pdf");

    const newPage = (): PDFPage => {
      const page = b.doc.addPage([612, 792]);
      page.drawPage(header, { x: 0, y: 682 });
      const center = (text: string, box: Box, size: number) => {
        if (!text) return;
        let s = size;
        while (s > 5 && widthOf(text, b.fonts.field, s) > box.w - 4) s -= 0.25;
        page.drawText(text, { x: box.x + (box.w - widthOf(text, b.fonts.field, s)) / 2, y: box.y + (box.h - s * 0.7) / 2, size: s, font: b.fonts.field });
      };
      center(list.title, { x: 66, y: 703, w: 170, h: 20 }, 10);
      center(list.ability, { x: 293, y: 734, w: 49, h: 16 }, 8.5);
      center(list.attack, { x: 368, y: 734, w: 49, h: 16 }, 8.5);
      center(list.save, { x: 443, y: 734, w: 49, h: 16 }, 8.5);
      center(list.prepare, { x: 518, y: 734, w: 49, h: 16 }, 8.5);
      y = 672; // top of the first section
      return page;
    };
    let p = newPage();

    for (const section of list.levels) {
      const rows = Math.max(2, Math.ceil((section.spells.length + 1) / 3));
      const height = 24 + (rows - 2) * ROW + 24;
      if (y - height < 20) p = newPage();

      const top = await b.partial(`Partial.Spellcasting.red_spells_top${section.level}.pdf`);
      const middle = await b.partial("Partial.Spellcasting.red_spells_middle.pdf");
      const bottom = await b.partial("Partial.Spellcasting.red_spells_bottom.pdf");
      p.drawPage(top, { x: 0, y: y - 24 });
      for (let r = 0; r < rows - 2; r++) p.drawPage(middle, { x: 0, y: y - 24 - (r + 1) * ROW });
      p.drawPage(bottom, { x: 0, y: y - 24 - (rows - 2) * ROW - 24 });

      const rowBottom = (row: number) => y - 24 - row * ROW; // row 0 is the top strip's lower half
      if (section.level > 0 && section.slots > 0) {
        p.drawText(`${section.slots} SPELL SLOTS`, { x: 83, y: rowBottom(0) + 3.9, size: 5, font: b.fonts.bold, color: WHITE });
        for (let k = 0; k < section.slots; k++) {
          p.drawCircle({ x: 196.8 - k * 10, y: rowBottom(0) + 6, size: 3, color: WHITE, borderColor: GRAY, borderWidth: 0.4 });
        }
      }
      section.spells.forEach((spell, i) => {
        const cell = i + 1;
        const row = Math.floor(cell / 3);
        const x = SPELL_COLUMNS[cell % 3];
        const base = rowBottom(row);
        let size = 7;
        while (size > 4.5 && widthOf(spell.name, b.fonts.regular, size) > 152) size -= 0.25;
        p.drawText(clean(spell.name), { x: x + 2, y: base + 3, size, font: b.fonts.regular });
        if (spell.prepared) drawCheck(p, { x: x - 13, y: base + 1, w: 8, h: 10, size: 0, align: 0, multiline: false, color: BLACK }, "dot", b.fonts);
      });
      y -= height;
    }
  }
}

// cards: nine per page at Aurora's positions
const CARD_X = [26, 215, 404];
const CARD_Y = [526, 277, 28];

async function spellCards(b: SheetBuilder, data: SheetData) {
  const spells = data.cardSpells;
  const card = await b.partial("Partial.spellcard.pdf");
  let p = b.doc.getPage(0);
  spells.forEach((spell: SheetSpell, i) => {
    if (i % 9 === 0) p = b.doc.addPage([612, 792]);
    const x0 = CARD_X[i % 3];
    const y0 = CARD_Y[Math.floor(i / 3) % 3];
    p.drawPage(card, { x: x0, y: y0 });

    const centered = (text: string, font: PDFFont, size: number, y: number, max: number) => {
      let s = size;
      while (s > 5 && widthOf(text, font, s) > max) s -= 0.25;
      p.drawText(text, { x: x0 + 90 - widthOf(text, font, s) / 2, y: y0 + y, size: s, font });
    };
    centered(clean(spell.name), b.fonts.regular, 10, 225.5, 160);
    centered(clean(spellLevelLine(spell)), b.fonts.italic, 6, 213, 160);

    const rows: [string, string][] = [
      ["CASTING TIME", spell.time],
      ["RANGE", spell.range],
      ["DURATION", spell.concentration && !/concentration/i.test(spell.duration) ? `Concentration, ${spell.duration}` : spell.duration],
      ["COMPONENTS", spell.components],
    ];
    // the card template prints the labels; the values go beside them
    rows.forEach(([, value], r) => {
      const baseline = y0 + 240 - (34.5 + r * 11) - 4.6;
      let size = 6;
      const text = clean(value);
      while (size > 4 && widthOf(text, b.fonts.regular, size) > 118) size -= 0.25;
      p.drawText(text, { x: x0 + 53.5, y: baseline, size, font: b.fonts.regular });
    });

    drawParagraphs(p, { x: x0 + 3, y: y0 + 14, w: 174, h: 240 - 79 - 14 }, htmlParagraphs(spell.description), b.fonts, { size: 6, minSize: 3.5, paragraphGap: 0, lineHeight: 1.0 });
    p.drawText(clean(spell.origin), { x: x0 + 6, y: y0 + 6.4, size: 6, font: b.fonts.italic });
    const source = clean(spell.source);
    p.drawText(source, { x: x0 + 174 - widthOf(source, b.fonts.italic, 6), y: y0 + 6.4, size: 6, font: b.fonts.italic });
  });
}

/**
 * Item cards like Aurora's: the item's (or the player's) name, the category under it, the description, and the
 * weight and book at the foot; nine to a page, after the spell cards.
 */
async function itemCards(b: SheetBuilder, data: SheetData) {
  if (data.itemCards.length === 0) return;
  const card = await b.partial("Partial.card.pdf");
  let p = b.doc.getPage(0);
  data.itemCards.forEach((item, i) => {
    if (i % 9 === 0) p = b.doc.addPage([612, 792]);
    const x0 = CARD_X[i % 3];
    const y0 = CARD_Y[Math.floor(i / 3) % 3];
    p.drawPage(card, { x: x0, y: y0 });

    const centered = (text: string, font: PDFFont, size: number, y: number, max: number) => {
      let sz = size;
      while (sz > 5 && widthOf(text, font, sz) > max) sz -= 0.25;
      p.drawText(text, { x: x0 + 90 - widthOf(text, font, sz) / 2, y: y0 + y, size: sz, font });
    };
    // positions inside the card from Aurora's generic card page (title box 8,224 168x14; subtitle 11,212 160x9)
    centered(clean(item.title), b.fonts.regular, 10, 227.5, 160);
    centered(clean(item.subtitle), b.fonts.italic, 6, 214.5, 156);
    drawParagraphs(p, { x: x0 + 4, y: y0 + 20, w: 172, h: 186 }, htmlParagraphs(item.html), b.fonts, { size: 6, minSize: 3.5, paragraphGap: 0, lineHeight: 1.0 });
    p.drawText(clean(item.weight), { x: x0 + 6, y: y0 + 6.4, size: 6, font: b.fonts.regular });
    const source = clean(item.source);
    p.drawText(source, { x: x0 + 174 - widthOf(source, b.fonts.regular, 6), y: y0 + 6.4, size: 6, font: b.fonts.regular });
  });
}

/**
 * The whole sheet as PDF bytes: details, background, equipment and notes pages, then spellcasting pages and spell
 * cards for casters.
 */
export async function buildAuroraSheet(data: SheetData): Promise<Uint8Array> {
  const b = await SheetBuilder.create();
  await detailsPage(b, data);
  const overflow = await backgroundPage(b, data);
  await equipmentPage(b, data);
  await notesPage(b, data, overflow);
  if (data.spellPages.length > 0) {
    await spellcastingPages(b, data);
    await spellCards(b, data);
  }
  await itemCards(b, data);
  b.doc.setTitle(`${data.name}: character sheet`);
  return b.doc.save();
}
