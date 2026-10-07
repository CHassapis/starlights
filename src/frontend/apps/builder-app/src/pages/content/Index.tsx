/**
 * Content: where this install gets its rules and its Compendium from. The admin gives the two GitHub links (Aurora
 * Legacy's elements and the 5etools data, or forks of them) and the server downloads them, imports them, builds the
 * Compendium of Lore and updates every character, showing its steps here. On a server that updates its content with
 * its own scripts (the homelab), the page only says so.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, DatabaseIcon, ExternalLinkIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { useIsAdmin } from "@/lib/player";

interface ContentSources {
  selfManaged: boolean;
  settings: { auroraLink: string; fiveEToolsLink: string; auroraCommit?: string | null; fiveEToolsCommit?: string | null; updatedAt?: string | null };
  defaultAurora: string;
  defaultFiveETools: string;
  job: { running: boolean; step?: string | null; log: string[]; startedAt?: string | null; finishedAt?: string | null; succeeded?: boolean | null };
}

const KEY = ["content-sources"];

export function ContentPage() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.get<ContentSources>("/api/admin/content-sources"),
    enabled: admin,
    refetchInterval: (q) => (q.state.data?.job.running ? 2000 : false),
  });
  const save = useMutation({
    mutationFn: (body: { auroraLink: string; fiveEToolsLink: string; update: boolean; force: boolean }) => apiClient.put<typeof body, ContentSources>("/api/admin/content-sources", body),
    onSuccess: (d) => qc.setQueryData(KEY, d),
    onSettled: () => {
      for (const key of [KEY, ["sources"], ["item-catalog"], ["lore"]]) qc.invalidateQueries({ queryKey: key }).catch(() => {});
    },
  });

  if (!admin) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-sm text-muted-foreground">
        The Content page is for the admin: unlock it with the key button at the top.
      </div>
    );
  }
  if (isLoading) return <Spinner className="mx-auto my-10 size-6" />;
  if (error || !data) return <p className="py-10 text-center text-sm text-destructive">Could not load the content settings. {error?.message}</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 font-heading text-3xl font-semibold">
          <DatabaseIcon className="size-7 text-muted-foreground" /> Content
        </h1>
        <p className="text-muted-foreground">
          Where the rules (classes, species, spells, items) and the Compendium of Lore come from. Give the two GitHub links and the server does the rest: it
          downloads them, imports them, builds the Compendium and updates every character.
        </p>
      </header>
      {data.selfManaged ? <Sources data={data} busy={save.isPending} onSave={(body) => save.mutate(body, { onError: (e) => toast.error("Could not save", { description: e.message.match(/"generalErrors":\["([^"]+)/)?.[1] ?? e.message }) })} /> : <ManagedElsewhere data={data} />}
      <Job job={data.job} />
    </div>
  );
}

function Sources({ data, busy, onSave }: { data: ContentSources; busy: boolean; onSave: (body: { auroraLink: string; fiveEToolsLink: string; update: boolean; force: boolean }) => void }) {
  const [aurora, setAurora] = useState(data.settings.auroraLink);
  const [fiveE, setFiveE] = useState(data.settings.fiveEToolsLink);
  const running = data.job.running;
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <Link
        id="aurora-link"
        label="Aurora Legacy (the builder's rules)"
        hint="github.com/AuroraLegacy/elements, or your own fork of it. A branch as …/tree/branch-name."
        value={aurora}
        onChange={setAurora}
        fallback={data.defaultAurora}
        commit={data.settings.auroraCommit}
      />
      <Link
        id="fiveetools-link"
        label="5etools (the Compendium of Lore, deities, starting equipment)"
        hint="github.com/5etools-mirror-3/5etools-src, or your own fork. Only its data folder is downloaded."
        value={fiveE}
        onChange={setFiveE}
        fallback={data.defaultFiveETools}
        commit={data.settings.fiveEToolsCommit}
      />
      <p className="text-xs text-muted-foreground">GitHub links only. Your homebrew is never touched.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || running || !aurora.trim() || !fiveE.trim()} onClick={() => onSave({ auroraLink: aurora, fiveEToolsLink: fiveE, update: true, force: false })}>
          {running ? <Spinner /> : <RefreshCwIcon />} Save and update now
        </Button>
        <Button variant="outline" disabled={busy || running} onClick={() => onSave({ auroraLink: aurora, fiveEToolsLink: fiveE, update: true, force: true })}>
          Download everything again
        </Button>
        {data.settings.updatedAt && <span className="text-xs text-muted-foreground">Last updated {new Date(data.settings.updatedAt).toLocaleString()}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        The first time takes about 10 minutes; after that only what changed is downloaded. For a nightly update, see "Updating" in the README.
      </p>
    </section>
  );
}

function Link({ id, label, hint, value, onChange, fallback, commit }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void; fallback: string; commit?: string | null }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={fallback} spellCheck={false} className="font-mono text-xs" />
        {value !== fallback && (
          <Button variant="ghost" size="sm" onClick={() => onChange(fallback)}>
            Use the standard one
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {hint}
        {commit ? ` Now at ${commit.slice(0, 7)}.` : " Not downloaded yet."}
      </p>
    </div>
  );
}

function ManagedElsewhere({ data }: { data: ContentSources }) {
  return (
    <section className="space-y-2 rounded-lg border p-4 text-sm">
      <p>This server keeps its content up to date with its own scripts (a nightly job), so the links can't be changed here.</p>
      <ul className="space-y-1 text-muted-foreground">
        {[data.defaultAurora, data.defaultFiveETools].map((link) => (
          <li key={link}>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              {link.replace("https://", "")} <ExternalLinkIcon className="size-3" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Job({ job }: { job: ContentSources["job"] }) {
  if (!job.running && job.log.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-medium">
        {job.running ? <Spinner /> : job.succeeded ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <XCircleIcon className="size-4 text-destructive" />}
        {job.running ? (job.step ?? "Working…") : job.succeeded ? "The content is up to date" : "The update stopped"}
      </h2>
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{job.log.join("\n")}</pre>
    </section>
  );
}
