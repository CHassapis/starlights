import { ExternalLinkIcon, SparklesIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import type { PartyMember } from "@/lib/api/campaigns";
import { useSheetData, type SheetData } from "@/lib/api/sheet";
import { formatCoins } from "@/lib/rules/ledger";
import { cn } from "@/lib/utils";

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * The DM's look at the party: one card per character in the campaign with what a DM reaches for at the table
 * (armour class, hit points, passive scores, save DCs, languages, coins and magic items). Only the DM sees it.
 */
export function PartySummary({ party }: { party: PartyMember[] }) {
  if (party.length === 0) return <p className="text-sm text-muted-foreground">Nobody has added a character to this campaign yet. Players add theirs from their character's page (Campaigns).</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Only you see this. It reads each character as it is now, so it changes when the players level up or change their gear.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {party.map((m) => (m.missing ? <Missing key={m.characterId} member={m} /> : <MemberCard key={m.characterId} member={m} />))}
      </div>
    </div>
  );
}

function Missing({ member }: { member: PartyMember }) {
  return (
    <article className="rounded-lg border p-3 opacity-60">
      <p className="font-medium">{member.name}</p>
      <p className="text-xs text-muted-foreground">This character was removed from Starlights.</p>
    </article>
  );
}

function MemberCard({ member }: { member: PartyMember }) {
  const sheet = useSheetData(member.characterId);
  return (
    <article className="space-y-3 rounded-lg border p-3">
      <header className="flex items-start gap-3">
        {member.portraitUrl ? (
          <img src={member.portraitUrl} alt="" className="size-14 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
            <UsersIcon className="size-5 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium leading-tight">{member.name}</h3>
          <p className="text-xs text-muted-foreground">{[sheet.data?.classLine ?? (member.build && `${member.build}${member.level ? ` ${member.level}` : ""}`), member.playerName && `played by ${member.playerName}`].filter(Boolean).join(" · ")}</p>
        </div>
        <Link to={`/characters/${member.characterId}/sheet`} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${member.name}'s sheet`}>
          <ExternalLinkIcon className="size-4" />
        </Link>
      </header>
      {sheet.error ? (
        <p className="text-sm text-destructive">Could not read this character: {sheet.error.message}</p>
      ) : !sheet.data ? (
        <Spinner className="mx-auto size-4" />
      ) : (
        <Details s={sheet.data} />
      )}
    </article>
  );
}

function skill(s: SheetData, name: string) {
  return s.skills.find((k) => k.name === name)?.calculatedBonus ?? 0;
}

function Details({ s }: { s: SheetData }) {
  const speeds = [`${s.speeds.walk} ft`, s.speeds.fly && `fly ${s.speeds.fly}`, s.speeds.swim && `swim ${s.speeds.swim}`, s.speeds.climb && `climb ${s.speeds.climb}`].filter(Boolean).join(", ");
  const defenses = [
    s.defenses.resistances.length && `Resists ${s.defenses.resistances.join(", ")}`,
    s.defenses.immunities.length && `Immune to ${s.defenses.immunities.join(", ")}`,
    s.defenses.vulnerabilities.length && `Vulnerable to ${s.defenses.vulnerabilities.join(", ")}`,
  ].filter(Boolean);
  const magic = s.equipment.magicGear;
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Armor class" value={s.armorClass} />
        <Stat label="Max HP" value={s.hitPoints ?? "—"} />
        <Stat label="Initiative" value={signed(s.initiative)} />
      </dl>
      <p className="leading-snug">
        <span className="mr-1.5 text-xs font-medium uppercase text-muted-foreground">Passive</span>
        Perception <strong>{s.passivePerception}</strong> · Insight <strong>{10 + skill(s, "Insight")}</strong> · Investigation <strong>{10 + skill(s, "Investigation")}</strong>
      </p>
      <div className="grid grid-cols-6 gap-1 text-center">
        {s.abilities.map((a) => {
          const save = s.saves.find((x) => x.abilityScoreAbbreviation === a.abbreviation);
          return (
            <div key={a.abbreviation} className="rounded-md bg-muted/50 px-1 py-1">
              <div className="text-[10px] font-medium uppercase text-muted-foreground">{a.abbreviation}</div>
              <div className="font-medium">{a.calculatedScore}</div>
              <div className={cn("text-[10px]", save?.proficiency && save.proficiency !== "none" ? "font-semibold text-foreground" : "text-muted-foreground")} title="Saving throw">
                save {signed(save?.calculatedBonus ?? a.calculatedModifier)}
              </div>
            </div>
          );
        })}
      </div>
      <Line label="Speed">{speeds}</Line>
      {s.vision.length > 0 && <Line label="Senses">{s.vision.join(", ")}</Line>}
      {s.spellcasting.length > 0 && (
        <Line label="Spells">
          {s.spellcasting.map((c) => `${c.name}: save DC ${c.saveDc}, attack ${signed(c.attackBonus)}`).join(" · ")}
        </Line>
      )}
      {defenses.length > 0 && <Line label="Defenses">{defenses.join(" · ")}</Line>}
      <Line label="Languages">{s.languages.join(", ") || "—"}</Line>
      <Line label="Coins">{formatCoins(s.equipment.coins)}</Line>
      <Line label="Magic items">
        {magic.length === 0 ? (
          "—"
        ) : (
          <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
            {magic.map((g) => (
              <span key={g.name} className="inline-flex items-center gap-1">
                <SparklesIcon className="size-3 text-muted-foreground" />
                {g.name}
                {g.count > 1 ? ` ×${g.count}` : ""}
              </span>
            ))}
          </span>
        )}
        {s.equipment.attunementMax > 0 && <span className="text-xs text-muted-foreground"> · attuned {s.equipment.attuned}/{s.equipment.attunementMax}</span>}
      </Line>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border px-2 py-1 text-center">
      <dt className="truncate text-[10px] uppercase leading-tight text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold leading-tight">{value}</dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="leading-snug">
      <span className="mr-1.5 text-xs font-medium uppercase text-muted-foreground">{label}</span>
      {children}
    </p>
  );
}
