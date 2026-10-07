/**
 * The Content page's status sections: the server (the Starlights version it runs, its database changes and a few
 * counts) and the content (Aurora Legacy's commit, the 5etools release, the last update that worked, whether one is
 * running, and, when the admin asks, what GitHub has that is newer). Checking only reads; updating is always the
 * admin's explicit action: the Update button on installs that bring in their own content, the server's own command
 * on one that updates with its own scripts (the homelab), which the page can't and doesn't run.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, CopyIcon, GitCommitHorizontalIcon, RefreshCwIcon, SearchIcon, ServerIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface ContentSourceStatus {
  name: string;
  link: string;
  commit?: string | null;
  version?: string | null;
  versionDate?: string | null;
  changedAt?: string | null;
  checkedAt?: string | null;
}

export interface NightlyStatus {
  running: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  ok?: boolean | null;
  changes: string[];
  failures: string[];
  lastSuccessAt?: string | null;
}

export interface ContentStatus {
  sources: ContentSourceStatus[];
  running: boolean;
  lastSuccessAt?: string | null;
  nightly?: NightlyStatus | null;
  updateCommand?: string | null;
}

interface ContentSourceCheck {
  name: string;
  link: string;
  updateAvailable?: boolean | null;
  current?: string | null;
  latest?: string | null;
  latestDate?: string | null;
  commitsBehind?: number | null;
  commits: { id: string; message: string; date?: string | null }[];
  filesChanged?: number | null;
  files: string[];
  releaseNotes?: string | null;
  whatDownloads: string;
  problem?: string | null;
}

interface ContentCheck {
  checkedAt: string;
  cached: boolean;
  sources: ContentSourceCheck[];
}

interface ServerStatus {
  commit?: string | null;
  builtAt: string;
  startedAt: string;
  databaseReachable: boolean;
  databaseProblem?: string | null;
  migrations: { module: string; applied: number; known: number; latest?: string | null; pending: string[] }[];
  counts?: { characters: number; players: number; campaigns: number; campaignEntries: number; elements: number; homebrewFiles: number; homebrewItems: number; homebrewMonsters: number } | null;
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : null);
const short = (commit?: string | null) => (commit && /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit);
// "20261006175931_CampaignUseHomebrew" → "CampaignUseHomebrew (2026-10-06)"
const migrationName = (id?: string | null) => (id ? id.replace(/^(\d{4})(\d{2})(\d{2})\d{6}_(.+)$/, "$4 ($1-$2-$3)") : "none");

/** The server: version, database changes per module, counts. */
export function ServerSection() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => apiClient.get<ServerStatus>("/api/admin/status"),
  });
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="server-status">
      <h2 id="server-status" className="flex items-center gap-2 font-medium">
        <ServerIcon className="size-4 text-muted-foreground" /> Server
      </h2>
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Could not read the server's status. {error?.message}</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Starlights version</dt>
          <dd>
            {data.commit ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{data.commit}</code> : <span className="text-muted-foreground">unknown (built without STARLIGHTS_COMMIT)</span>}
            <span className="text-muted-foreground">
              {" "}
              · built {when(data.builtAt)} · running since {when(data.startedAt)}
            </span>
          </dd>
          <dt className="text-muted-foreground">Database</dt>
          <dd className="space-y-1">
            {data.databaseReachable ? (
              data.migrations.map((m) => (
                <div key={m.module} className={cn(m.pending.length > 0 && "text-amber-700 dark:text-amber-400")}>
                  {m.pending.length > 0 ? <AlertTriangleIcon className="mr-1 inline size-3.5" /> : <CheckCircle2Icon className="mr-1 inline size-3.5 text-emerald-600" />}
                  {m.module}: {m.applied} of {m.known} changes applied, the newest {migrationName(m.latest)}
                  {m.pending.length > 0 && <> · not applied yet: {m.pending.map(migrationName).join(", ")} (the migration containers apply them when the stack starts)</>}
                </div>
              ))
            ) : (
              <span className="text-destructive">Not reachable: {data.databaseProblem}</span>
            )}
          </dd>
          {data.counts && (
            <>
              <dt className="text-muted-foreground">In it</dt>
              <dd>
                {data.counts.characters} characters · {data.counts.players} players with a password · {data.counts.campaigns} campaigns with {data.counts.campaignEntries} entries ·{" "}
                {data.counts.elements.toLocaleString()} rules elements
              </dd>
              <dt className="text-muted-foreground">Homebrew</dt>
              <dd>
                {data.counts.homebrewFiles} element files, {data.counts.homebrewItems} items made on the Homebrew page, {data.counts.homebrewMonsters} monsters
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

/**
 * The content as it is here, and on request what GitHub has that is newer. onUpdate is the Update button's action
 * (installs that bring in their own content); without it the server's own command is shown instead.
 */
export function ContentStatusSection({ status, step, onUpdate, updating }: { status: ContentStatus; step?: string | null; onUpdate?: () => void; updating: boolean }) {
  // asked for with the button only; "Check again" asks GitHub again (the server still shows a check under a minute old)
  const check = useMutation({
    mutationFn: (again: boolean) => apiClient.get<ContentCheck>(`/api/admin/content-sources/check${again ? "?force=true" : ""}`),
  });
  const available = check.data?.sources.some((s) => s.updateAvailable) ?? false;
  const nightly = status.nightly;
  // (when the page opened: a run that started over two hours before is probably not running any more)
  const [openedAt] = useState(() => Date.now());
  const stuck = nightly?.running && nightly.startedAt && openedAt - new Date(nightly.startedAt).getTime() > 2 * 3600_000;

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="content-status">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="content-status" className="flex items-center gap-2 font-medium">
          <GitCommitHorizontalIcon className="size-4 text-muted-foreground" /> Content status
        </h2>
        {status.running ? (
          <Badge variant="outline" className="gap-1">
            <Spinner className="size-3" /> Updating now{step ? `: ${step}` : ""}
          </Badge>
        ) : check.data ? (
          available ? (
            <Badge className="bg-amber-500 text-black hover:bg-amber-500">Update available</Badge>
          ) : check.data.sources.every((s) => s.updateAvailable === false) ? (
            <Badge variant="outline" className="border-emerald-600/50 text-emerald-700 dark:text-emerald-400">
              Up to date
            </Badge>
          ) : null
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {status.sources.map((s) => (
          <SourceLine key={s.name} source={s} />
        ))}
        <dt className="text-muted-foreground">Last update that worked</dt>
        <dd>{when(status.lastSuccessAt) ?? <span className="text-muted-foreground">none recorded yet</span>}</dd>
        {nightly && (
          <>
            <dt className="text-muted-foreground">Nightly job</dt>
            <dd className="space-y-1">
              {nightly.running ? (
                <div className={cn(stuck && "text-amber-700 dark:text-amber-400")}>
                  Running since {when(nightly.startedAt)}
                  {stuck ? " (for over two hours: it may have stopped; see its log)" : ""}
                </div>
              ) : (
                <div className={cn(nightly.ok === false && "text-destructive")}>
                  {nightly.ok === false ? `Last run ${when(nightly.finishedAt)}: ${nightly.failures.length} step(s) failed` : `Last run ${when(nightly.finishedAt)}: fine`}
                  {nightly.changes.length === 0 && nightly.ok !== false ? ", nothing new" : ""}
                </div>
              )}
              {[...nightly.failures.map((f) => `failed: ${f}`), ...nightly.changes].map((line) => (
                <div key={line} className="text-xs text-muted-foreground">
                  {line}
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => check.mutate(!!check.data)}
        >
          {check.isPending ? <Spinner /> : <SearchIcon />} {check.data ? "Check again" : "Check for updates"}
        </Button>
        {onUpdate && (
          <Button size="sm" disabled={updating || status.running} onClick={onUpdate} className={cn(available && "bg-amber-500 text-black hover:bg-amber-400")}>
            {status.running ? <Spinner /> : <RefreshCwIcon />} Update now
          </Button>
        )}
        {check.data && (
          <span className="text-xs text-muted-foreground">
            Checked {when(check.data.checkedAt)}
            {check.data.cached ? " (shown again: GitHub allows 60 checks an hour)" : ""}
          </span>
        )}
      </div>
      {check.error && <p className="text-sm text-destructive">Could not check: {check.error.message}</p>}
      {check.data?.sources.map((s) => (
        <SourceCheck key={s.name} source={s} />
      ))}

      {!onUpdate && status.updateCommand && (
        <div className="space-y-1 rounded-md bg-muted/60 p-3 text-sm">
          <p>This server brings in its content with its own nightly job (03:30), never from this page. To update now, run on the server:</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-background px-2 py-1 text-xs">{status.updateCommand}</code>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy the command"
              onClick={() => {
                navigator.clipboard?.writeText(status.updateCommand ?? "").then(
                  () => toast.success("Copied"),
                  () => toast.error("Could not copy"),
                );
              }}
            >
              <CopyIcon />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SourceLine({ source }: { source: ContentSourceStatus }) {
  const what = source.version ? `release ${source.version}${source.versionDate ? ` (${source.versionDate})` : ""}` : source.commit ? `commit ${short(source.commit)}` : null;
  return (
    <>
      <dt className="text-muted-foreground">{source.name}</dt>
      <dd>
        {what ?? <span className="text-muted-foreground">not downloaded yet</span>}
        {source.version && source.commit ? ` · commit ${short(source.commit)}` : ""}
        {source.changedAt && <span className="text-muted-foreground"> · changed {when(source.changedAt)}</span>}
        {source.checkedAt && <span className="text-muted-foreground"> · last fetched {when(source.checkedAt)}</span>}
        <div className="truncate text-xs text-muted-foreground">{source.link.replace("https://", "")}</div>
      </dd>
    </>
  );
}

function SourceCheck({ source }: { source: ContentSourceCheck }) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{source.name}</span>
        {source.updateAvailable === true ? (
          <Badge className="bg-amber-500 text-black hover:bg-amber-500">Update available</Badge>
        ) : source.updateAvailable === false ? (
          <Badge variant="outline" className="border-emerald-600/50 text-emerald-700 dark:text-emerald-400">
            Up to date
          </Badge>
        ) : (
          <Badge variant="outline">Unknown</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {short(source.current) ?? "nothing"} here → {short(source.latest) ?? "?"} on GitHub{source.latestDate ? ` (${new Date(source.latestDate).toLocaleDateString()})` : ""}
        </span>
      </div>
      {source.problem && <p className="text-xs text-amber-700 dark:text-amber-400">{source.problem}</p>}
      {source.updateAvailable && (
        <>
          {source.commitsBehind ? (
            <div>
              <p className="text-xs text-muted-foreground">
                {source.commitsBehind} new commit{source.commitsBehind === 1 ? "" : "s"}
                {source.filesChanged ? `, ${source.filesChanged} file${source.filesChanged === 1 ? "" : "s"} changed` : ""}
                {source.commits.length < source.commitsBehind ? ` (the newest ${source.commits.length})` : ""}:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {source.commits.map((c) => (
                  <li key={c.id}>
                    <code className="text-muted-foreground">{c.id}</code> {c.message}
                    {c.date ? <span className="text-muted-foreground"> · {new Date(c.date).toLocaleDateString()}</span> : null}
                  </li>
                ))}
              </ul>
              {source.files.length > 0 && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Files that changed</summary>
                  <ul className="mt-1 columns-1 font-mono sm:columns-2">
                    {source.files.map((f) => (
                      <li key={f} className="truncate">
                        {f}
                      </li>
                    ))}
                    {source.filesChanged && source.filesChanged > source.files.length ? <li>… and {source.filesChanged - source.files.length} more</li> : null}
                  </ul>
                </details>
              )}
            </div>
          ) : null}
          {source.releaseNotes && (
            <details className="text-xs" open>
              <summary className="cursor-pointer text-muted-foreground">What's new in {source.latest}</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans">{source.releaseNotes}</pre>
            </details>
          )}
          <p className="text-xs text-muted-foreground">{source.whatDownloads}</p>
        </>
      )}
    </div>
  );
}
