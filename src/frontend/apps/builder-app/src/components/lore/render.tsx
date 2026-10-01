/**
 * Renders 5etools "entries" (nested JSON of paragraphs, named sections, lists, tables, insets, read-aloud boxes,
 * quotes, pictures and stat blocks, with {@tag} markup in the text) as the app's own themed components.
 * Written for this app; it follows the data's structure, not 5etools' renderer.
 */
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { TAG_CATEGORY } from "@/lib/lore/categories";
import { imageUrl, tagKey } from "@/lib/lore/data";
import { describeRoll, parseDice, roll } from "@/lib/lore/dice";
import { parseTags, plainTagText, displayText, type TagNode } from "@/lib/lore/tags";
import { cn } from "@/lib/utils";
import { LoreLink } from "./lore-link";
import { EmbeddedEntry } from "./embedded-entry";
import { RenderContext, useLoreRender, type LoreRenderContext } from "./render-context";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function LoreRenderProvider({ value, children }: { value: LoreRenderContext; children: ReactNode }) {
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}

// ---------------------------------------------------------------- inline text

/** Text with {@tag} markup. */
export function RichText({ text }: { text: string }) {
  return <>{parseTags(text).map((n, i) => (typeof n === "string" ? <Fragment key={i}>{n}</Fragment> : <Tag key={i} node={n} />))}</>;
}

function DiceTag({ expression, label, title }: { expression: string; label: ReactNode; title: string }) {
  const parsed = parseDice(expression);
  if (!parsed) return <span className="font-medium">{label}</span>;
  return (
    <button
      type="button"
      className="rounded-sm font-medium text-primary underline decoration-primary/40 decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-ring"
      title={`Roll ${expression}`}
      onClick={() => {
        const r = roll(parsed);
        toast(`${title}: ${r.total}`, { description: `${expression.replace(/\s+/g, " ")} → ${describeRoll(r)}` });
      }}
    >
      {label}
    </button>
  );
}

function Tag({ node }: { node: TagNode }) {
  const { meta, book } = useLoreRender();
  const [a = "", b = ""] = node.args;
  switch (node.tag) {
    case "b":
    case "bold":
      return <strong><RichText text={node.text} /></strong>;
    case "i":
    case "italic":
      return <em><RichText text={node.text} /></em>;
    case "u":
    case "underline":
    case "u2":
    case "underlineDouble":
      return <u><RichText text={node.text} /></u>;
    case "s":
    case "strike":
    case "s2":
    case "strikeDouble":
      return <s><RichText text={node.text} /></s>;
    case "sup":
      return <sup><RichText text={node.text} /></sup>;
    case "sub":
      return <sub><RichText text={node.text} /></sub>;
    case "code":
    case "kbd":
      return <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{node.text}</code>;
    case "note":
      return <span className="italic text-muted-foreground"><RichText text={node.text} /></span>;
    case "color":
    case "highlight":
    case "style":
    case "font":
    case "help":
    case "comic":
    case "comicH1":
    case "comicH2":
    case "comicH3":
    case "comicH4":
    case "comicNote":
    case "tip":
      return <RichText text={a} />;
    case "footnote":
      return (
        <>
          <RichText text={a} />
          {b && <sup className="ml-0.5 text-muted-foreground" title={b}>*</sup>}
        </>
      );
    case "atk":
    case "atkr":
    case "h":
    case "m":
    case "hom":
    case "actSave":
    case "actSaveFail":
    case "actSaveFailBy":
    case "actSaveSuccess":
    case "actSaveSuccessOrFail":
    case "actTrigger":
    case "actResponse":
      return <em>{plainTagText(node)}</em>;
    case "hit":
    case "d20":
      return <DiceTag expression={`1d20${Number(a) >= 0 ? "+" : ""}${a}`} label={plainTagText(node)} title="d20" />;
    case "dice":
    case "damage":
    case "autodice":
      return <DiceTag expression={a} label={b || a} title={node.tag === "damage" ? "Damage" : "Roll"} />;
    case "scaledice":
    case "scaledamage":
      return <DiceTag expression={node.args[2] || a} label={node.args[2] || a} title="Roll" />;
    case "chance":
      return <DiceTag expression="1d100" label={plainTagText(node)} title={`Chance (${a} or under)`} />;
    case "recharge":
      return <DiceTag expression="1d6" label={plainTagText(node)} title={`Recharge (${a || 6}${a && a !== "6" ? "–6" : ""})`} />;
    case "link":
      return (
        <a href={b} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
          {a}
        </a>
      );
    case "book":
    case "adventure": {
      const id = b;
      const chapter = node.args[2];
      const header = node.args[3];
      const to = `/lore/${node.tag === "book" ? "books" : "adventures"}/${encodeURIComponent(id.toLowerCase())}${chapter ? `?ch=${chapter}` : ""}${header ? `#${encodeURIComponent(header)}` : ""}`;
      return id ? <Link to={to} className="text-primary underline-offset-2 hover:underline"><RichText text={a} /></Link> : <RichText text={a} />;
    }
    case "area": {
      const id = b;
      const chapter = book && id ? book.chapterOf?.(id) : undefined;
      if (!book || chapter === undefined) return <span className="font-medium"><RichText text={a} /></span>;
      return (
        <Link to={`/lore/${book.kind}/${encodeURIComponent(book.id)}?ch=${chapter}#e-${encodeURIComponent(id)}`} className="text-primary underline-offset-2 hover:underline">
          <RichText text={a} />
        </Link>
      );
    }
    default: {
      const category = TAG_CATEGORY[node.tag];
      const shown = <RichText text={displayText(node)} />;
      if (!category) return shown;
      const key = tagKey(meta, node.tag, a, b);
      if (!meta.categories[category]) return <span className="underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">{shown}</span>;
      return (
        <LoreLink category={category} k={key}>
          {shown}
        </LoreLink>
      );
    }
  }
}

// ---------------------------------------------------------------- blocks

function Heading({ depth, id, children }: { depth: number; id?: string; children: ReactNode }) {
  const anchor = id ? `e-${id}` : undefined;
  if (depth <= 0) return <h2 id={anchor} className="mt-6 scroll-mt-20 border-b pb-1 font-heading text-2xl tracking-wide first:mt-0">{children}</h2>;
  if (depth === 1) return <h3 id={anchor} className="mt-5 scroll-mt-20 font-heading text-xl tracking-wide first:mt-0">{children}</h3>;
  return <h4 id={anchor} className="mt-4 scroll-mt-20 font-heading text-lg first:mt-0">{children}</h4>;
}

/** A list of entries. depth 0 is a book's chapter level; named entries deeper than 2 run into their first paragraph. */
export function Entries({ entries, depth = 0 }: { entries: unknown; depth?: number }) {
  return (
    <>
      {asArray(entries).map((e, i) => (
        <Entry key={i} entry={e} depth={depth} />
      ))}
    </>
  );
}

function Paragraph({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-2 leading-relaxed first:mt-0 last:mb-0", className)}>{children}</p>;
}

/** A named entry from depth 3 on: its name in bold italics, running into the first paragraph. */
function RunIn({ name, entries, id }: { name: string; entries: unknown; id?: string }) {
  const list = asArray(entries);
  const [first, ...rest] = list;
  const lead = (
    <strong className="font-semibold italic">
      <RichText text={name.endsWith(".") || name.endsWith(":") ? name : `${name}.`} />
    </strong>
  );
  return (
    <div id={id ? `e-${id}` : undefined} className="my-2 scroll-mt-20">
      {typeof first === "string" ? (
        <Paragraph>
          {lead} <RichText text={first} />
        </Paragraph>
      ) : (
        <>
          <Paragraph>{lead}</Paragraph>
          {first !== undefined && <Entry entry={first} depth={3} />}
        </>
      )}
      <Entries entries={rest} depth={3} />
    </div>
  );
}

export function Entry({ entry, depth = 0 }: { entry: unknown; depth?: number }): ReactNode {
  if (typeof entry === "string") return <Paragraph><RichText text={entry} /></Paragraph>;
  if (typeof entry === "number") return <Paragraph>{entry}</Paragraph>;
  if (!isObj(entry)) return null;
  const type = str(entry.type) ?? "entries";
  const name = str(entry.name);
  const id = str(entry.id);

  switch (type) {
    case "section":
    case "entries":
    case "chapter": {
      if (!name) return <Entries entries={entry.entries} depth={depth} />;
      if (depth >= 3) return <RunIn name={name} entries={entry.entries} id={id} />;
      return (
        <section>
          <Heading depth={type === "section" ? Math.min(depth, 0) : depth} id={id}>
            <RichText text={name} />
          </Heading>
          <Entries entries={entry.entries} depth={depth + 1} />
        </section>
      );
    }
    case "inset":
    case "variant":
    case "variantInner":
      return (
        <aside id={id ? `e-${id}` : undefined} className="my-4 scroll-mt-20 rounded-md border bg-muted/40 px-4 py-3 text-[0.95em]">
          {name && <p className="mb-1.5 font-heading text-base">{type === "variant" ? `Variant: ` : ""}<RichText text={name} /></p>}
          <Entries entries={entry.entries} depth={3} />
        </aside>
      );
    case "insetReadaloud":
      return (
        <aside id={id ? `e-${id}` : undefined} className="my-4 scroll-mt-20 rounded-r-md border-l-4 border-primary/60 bg-primary/5 px-4 py-3 font-serif text-[0.95em] leading-relaxed">
          {name && <p className="mb-1.5 font-heading text-base">{name}</p>}
          <Entries entries={entry.entries} depth={3} />
        </aside>
      );
    case "variantSub":
      return name ? <RunIn name={name} entries={entry.entries} id={id} /> : <Entries entries={entry.entries} depth={3} />;
    case "quote":
      return (
        <figure className="my-4 border-l-2 pl-4 italic text-muted-foreground">
          <blockquote>
            <Entries entries={entry.entries} depth={3} />
          </blockquote>
          {(str(entry.by) || str(entry.from)) && (
            <figcaption className="mt-1 text-right text-sm not-italic">
              — <RichText text={str(entry.by) ?? ""} />
              {str(entry.from) && <>, <em><RichText text={str(entry.from)!} /></em></>}
            </figcaption>
          )}
        </figure>
      );
    case "list":
      return <List entry={entry} />;
    case "item":
    case "itemSub":
    case "itemSpell":
      return name ? <RunIn name={name} entries={entry.entries ?? entry.entry} /> : <Entries entries={entry.entries ?? entry.entry} depth={depth} />;
    case "table":
      return <Table table={entry} />;
    case "tableGroup":
      return (
        <>
          {asArray(entry.tables).map((t, i) => (
            <Table key={i} table={t as Obj} />
          ))}
        </>
      );
    case "image":
      return <Picture image={entry} />;
    case "gallery":
      return (
        <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {asArray(entry.images).map((im, i) => (
            <Picture key={i} image={im as Obj} small />
          ))}
        </div>
      );
    case "hr":
      return <hr className="my-4" />;
    case "inline":
    case "inlineBlock":
      return (
        <Paragraph>
          {asArray(entry.entries).map((e, i) => (typeof e === "string" ? <RichText key={i} text={e} /> : <InlineEntry key={i} entry={e} />))}
        </Paragraph>
      );
    case "link":
      return <Paragraph><InlineEntry entry={entry} /></Paragraph>;
    case "dice":
    case "bonus":
    case "bonusSpeed":
      return <Paragraph><InlineEntry entry={entry} /></Paragraph>;
    case "abilityDc":
    case "abilityAttackMod":
    case "abilityGeneric":
      return <AbilityBox entry={entry} />;
    case "options":
      return <Entries entries={entry.entries} depth={Math.max(depth, 3)} />;
    case "flowchart":
    case "flowBlock":
      return (
        <div className="my-3 rounded-md border px-4 py-3">
          {name && <p className="mb-1 font-heading">{name}</p>}
          <Entries entries={entry.entries ?? entry.blocks} depth={3} />
        </div>
      );
    case "statblock":
    case "statblockInline":
      return <EmbeddedEntry entry={entry} />;
    case "refClassFeature":
    case "refSubclassFeature":
    case "refOptionalfeature": {
      const ref = str(entry.classFeature) ?? str(entry.subclassFeature) ?? str(entry.optionalfeature) ?? "";
      return <Paragraph className="font-medium">{ref.split("|")[0]}</Paragraph>;
    }
    case "attack":
      return (
        <Paragraph>
          <em>{({ MW: "Melee Weapon Attack:", RW: "Ranged Weapon Attack:", MS: "Melee Spell Attack:", RS: "Ranged Spell Attack:" } as Record<string, string>)[str(entry.attackType) ?? ""] ?? "Attack:"}</em>{" "}
          {asArray(entry.attackEntries).map((e, i) => (typeof e === "string" ? <RichText key={i} text={e} /> : null))} <em>Hit:</em>{" "}
          {asArray(entry.hitEntries).map((e, i) => (typeof e === "string" ? <RichText key={i} text={e} /> : null))}
        </Paragraph>
      );
    case "spellcasting":
      return <Spellcasting entry={entry} />;
    case "wrapper":
      return <Entry entry={entry.wrapped} depth={depth} />;
    case "homebrew":
      return null;
    default:
      if (entry.entries) return name ? <RunIn name={name} entries={entry.entries} id={id} /> : <Entries entries={entry.entries} depth={depth} />;
      if (entry.entry) return <Entry entry={entry.entry} depth={depth} />;
      return null;
  }
}

/** Entries that sit inside a sentence (an "inline" entry's parts). */
function InlineEntry({ entry }: { entry: unknown }) {
  if (typeof entry === "string") return <RichText text={entry} />;
  if (!isObj(entry)) return null;
  switch (entry.type) {
    case "link": {
      const href = entry.href as Obj | undefined;
      const url = href?.type === "external" ? str(href.url) : undefined;
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
          {str(entry.text)}
        </a>
      ) : (
        <span>{str(entry.text)}</span>
      );
    }
    case "dice": {
      const toRoll = asArray(entry.toRoll) as Obj[];
      const expression = toRoll.map((d) => `${d.number ?? 1}d${d.faces}${d.modifier ? `${Number(d.modifier) >= 0 ? "+" : ""}${d.modifier}` : ""}`).join("+");
      return <DiceTag expression={expression} label={expression} title="Roll" />;
    }
    case "bonus":
      return <>{Number(entry.value) >= 0 ? "+" : ""}{String(entry.value)}</>;
    case "bonusSpeed":
      return <>{Number(entry.value) >= 0 ? "+" : ""}{String(entry.value)} ft.</>;
    default:
      return <Entries entries={entry.entries} depth={3} />;
  }
}

function List({ entry }: { entry: Obj }) {
  const style = str(entry.style) ?? "";
  const columns = typeof entry.columns === "number" ? entry.columns : 1;
  const bare = style.includes("list-no-bullets") || style.includes("list-hang");
  const Tag = style.includes("decimal") ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "my-2 space-y-1 pl-5",
        bare ? "list-none pl-0" : Tag === "ol" ? "list-decimal" : "list-disc",
        columns > 1 && "sm:columns-2 sm:gap-8 lg:columns-3",
      )}
    >
      {asArray(entry.items).map((item, i) => (
        <li key={i} className="break-inside-avoid leading-relaxed">
          {typeof item === "string" ? (
            <RichText text={item} />
          ) : isObj(item) && (item.type === "item" || item.type === "itemSub" || item.type === "itemSpell") ? (
            <ListItem item={item} />
          ) : (
            <Entry entry={item} depth={3} />
          )}
        </li>
      ))}
    </Tag>
  );
}

function ListItem({ item }: { item: Obj }) {
  const name = str(item.name);
  const body = asArray(item.entries ?? item.entry);
  const [first, ...rest] = body;
  return (
    <>
      {name && (
        <strong className="font-semibold">
          <RichText text={name.endsWith(".") || name.endsWith(":") ? name : `${name}.`} />{" "}
        </strong>
      )}
      {typeof first === "string" ? <RichText text={first} /> : first !== undefined ? <Entry entry={first} depth={3} /> : null}
      <Entries entries={rest} depth={3} />
    </>
  );
}

function cellText(cell: unknown): ReactNode {
  if (typeof cell === "string") return <RichText text={cell} />;
  if (typeof cell === "number") return String(cell);
  if (!isObj(cell)) return null;
  if (cell.type === "cell") {
    const r = cell.roll as Obj | undefined;
    if (r) {
      const pad = r.pad ? 2 : 0;
      const n = (v: unknown) => String(v).padStart(pad, "0");
      if (r.exact !== undefined) return n(r.exact);
      return `${n(r.min)}${r.max !== undefined && r.max !== r.min ? `–${n(r.max)}` : ""}`;
    }
    return cell.entry !== undefined ? cellText(cell.entry) : null;
  }
  return <Entry entry={cell} depth={3} />;
}

function Table({ table }: { table: Obj }) {
  const labels = asArray(table.colLabels);
  const styles = asArray(table.colStyles).map((s) => String(s));
  const align = (i: number) => (styles[i]?.includes("text-center") ? "text-center" : styles[i]?.includes("text-right") ? "text-right" : "text-left");
  const rows = asArray(table.rows);
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {str(table.caption) && (
          <caption className="mb-1 text-left font-heading text-base">
            <RichText text={str(table.caption)!} />
          </caption>
        )}
        {labels.length > 0 && (
          <thead>
            <tr className="border-b">
              {labels.map((l, i) => (
                <th key={i} scope="col" className={cn("px-2 py-1.5 font-semibold", align(i))}>
                  {cellText(l)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => {
            const cells = isObj(row) && row.type === "row" ? asArray(row.row) : asArray(row);
            return (
              <tr key={r} className="even:bg-muted/40">
                {cells.map((c, i) => (
                  <td key={i} className={cn("px-2 py-1.5 align-top", align(i))}>
                    {cellText(c)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {asArray(table.footnotes).length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          <Entries entries={table.footnotes} depth={3} />
        </div>
      )}
    </div>
  );
}

/** A picture from the image repository, loaded only when it scrolls near, and left out when it is missing. */
export function Picture({ image, small = false }: { image: Obj; small?: boolean }) {
  const { meta } = useLoreRender();
  const [failed, setFailed] = useState(false);
  const url = imageUrl(meta, image.href);
  if (!url || failed) return null;
  const title = str(image.title);
  const width = typeof image.width === "number" ? image.width : undefined;
  const height = typeof image.height === "number" ? image.height : undefined;
  return (
    <figure className={cn("my-4", small ? "" : "flex flex-col items-center")}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={title ?? ""}
          loading="lazy"
          decoding="async"
          width={width}
          height={height}
          onError={() => setFailed(true)}
          className={cn("h-auto max-w-full rounded-md", small ? "max-h-48 w-full object-cover" : "max-h-[32rem] w-auto")}
        />
      </a>
      {(title || str(image.credit)) && (
        <figcaption className="mt-1 text-center text-xs text-muted-foreground">
          {title && <RichText text={title} />}
          {str(image.credit) && <span className="block">Art: {str(image.credit)}</span>}
        </figcaption>
      )}
    </figure>
  );
}

const ABILITY: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma", spellcasting: "spellcasting ability" };

function AbilityBox({ entry }: { entry: Obj }) {
  const name = str(entry.name) ?? "";
  const abilities = asArray(entry.attributes).map((a) => ABILITY[String(a)] ?? String(a)).join(" or ");
  const text =
    entry.type === "abilityDc"
      ? `${name} save DC = 8 + your proficiency bonus + your ${abilities} modifier`
      : entry.type === "abilityAttackMod"
        ? `${name} attack modifier = your proficiency bonus + your ${abilities} modifier`
        : `${name ? `${name} = ` : ""}${str(entry.text) ?? ""}`;
  return <p className="mx-auto my-3 w-fit rounded-md border px-3 py-1.5 text-center text-sm font-medium"><RichText text={text} /></p>;
}

/** A creature's spellcasting: its intro, then at-will, per-day and by-level spell lists. */
function Spellcasting({ entry }: { entry: Obj }) {
  const name = str(entry.name) ?? "Spellcasting";
  const lines: ReactNode[] = [];
  const spellList = (spells: unknown) =>
    asArray(spells).map((s, i) => (
      <Fragment key={i}>
        {i > 0 && ", "}
        {typeof s === "string" ? <RichText text={s} /> : isObj(s) ? <RichText text={str(s.entry) ?? ""} /> : null}
      </Fragment>
    ));
  if (entry.will) lines.push(<li key="will">At will: {spellList(entry.will)}</li>);
  for (const [k, v] of Object.entries((entry.daily as Obj) ?? {})) {
    const each = k.endsWith("e");
    lines.push(<li key={`d${k}`}>{k.replace("e", "")}/day{each ? " each" : ""}: {spellList(v)}</li>);
  }
  for (const [k, v] of Object.entries((entry.rest as Obj) ?? {})) lines.push(<li key={`r${k}`}>{k.replace("e", "")}/rest: {spellList(v)}</li>);
  for (const [k, v] of Object.entries((entry.spells as Obj) ?? {})) {
    const level = Number(k);
    const info = v as Obj;
    const slots = typeof info.slots === "number" ? ` (${info.slots} slot${info.slots === 1 ? "" : "s"})` : info.atWill ? " (at will)" : "";
    lines.push(
      <li key={`s${k}`}>
        {level === 0 ? "Cantrips (at will)" : `${level}${level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th"} level${slots}`}: {spellList(info.spells)}
      </li>,
    );
  }
  return (
    <div className="my-2">
      <RunIn name={name} entries={asArray(entry.headerEntries)} />
      {lines.length > 0 && <ul className="my-1 list-none space-y-0.5 pl-4 text-[0.95em]">{lines}</ul>}
      <Entries entries={entry.footerEntries} depth={3} />
    </div>
  );
}
