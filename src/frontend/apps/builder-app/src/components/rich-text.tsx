/**
 * Campaign text shown with its structure (lib/rich-text): headings, lists, tables, bold labels. A long document with
 * several headings gets a row of links to its sections at the top.
 */
import { useId, useMemo } from "react";
import { parseRichText, type Inline } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

const CONTENTS_AT = { headings: 4, length: 4000 };

function Line({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  const prefix = useId().replace(/:/g, "");
  const headings = blocks.filter((b) => b.kind === "heading");
  const contents = headings.length >= CONTENTS_AT.headings && text.length >= CONTENTS_AT.length;
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {contents && (
        <nav aria-label="Sections" className="flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          {headings.map((h) => (
            <a key={h.id} href={`#${prefix}-${h.id}`} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {h.text.length > 40 ? `${h.text.slice(0, 38)}…` : h.text}
            </a>
          ))}
        </nav>
      )}
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <h4 key={i} id={`${prefix}-${b.id}`} className="scroll-mt-20 pt-2 text-xs font-semibold uppercase tracking-wider text-foreground/80 first:pt-0">
                {b.text}
              </h4>
            );
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={i} className={cn("space-y-0.5 pl-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Line parts={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border">
                <table className="w-full border-collapse text-xs">
                  {b.header && (
                    <thead className="bg-muted/50">
                      <tr>
                        {b.header.map((c, j) => (
                          <th key={j} className="px-2 py-1.5 text-left font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-t align-top">
                        {row.map((c, k) => (
                          <td key={k} className="px-2 py-1.5">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    <Line parts={l} />
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
