import { cn } from "@/lib/utils";
import type { RulesEdition } from "@/lib/api/sources";

const EDITIONS: { value: RulesEdition; title: string; text: string }[] = [
  { value: "2014", title: "2014 rules", text: "The 2014 Player's Handbook and the books made for it." },
  { value: "2024", title: "2024 rules", text: "The 2024 Player's Handbook, with every supplement." },
  { value: "mixed", title: "Both, mixed", text: "Everything from both editions; they work together." },
];

/**
 * Which rules the character uses; a shortcut for the Sources below it (which stay adjustable).
 */
export function EditionPicker({ value, onChange }: { value: RulesEdition | null; onChange: (edition: RulesEdition) => void }) {
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {EDITIONS.map((e) => (
        <button
          key={e.value}
          type="button"
          role="radio"
          aria-checked={value === e.value}
          onClick={() => onChange(e.value)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
            value === e.value && "border-primary bg-muted ring-2 ring-primary/40",
          )}
        >
          <div className="font-medium">{e.title}</div>
          <div className="text-xs text-muted-foreground">{e.text}</div>
        </button>
      ))}
    </div>
  );
}
