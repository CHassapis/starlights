import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, FileUpIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useSources } from "@/lib/api/sources";
import { importAuroraCharacter, type AuroraImportReport } from "@/lib/aurora-character-import";

type FileState = { file: File; status: "waiting" | "importing" | "done" | "failed"; progress?: string; report?: AuroraImportReport; error?: string };

/**
 * Import characters saved by the Aurora desktop builder (.dnd5e files) into the current player's collection.
 */
export function AuroraImportDialog({ player }: { player: string }) {
  const qc = useQueryClient();
  const { data: sources } = useSources();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileState[]>([]);
  const [running, setRunning] = useState(false);

  function update(index: number, change: Partial<FileState>) {
    setFiles((current) => current.map((f, i) => (i === index ? { ...f, ...change } : f)));
  }

  async function run() {
    setRunning(true);
    const known = sources?.sources.map((s) => s.name) ?? [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done") continue;
      update(i, { status: "importing", progress: "Reading…" });
      try {
        const report = await importAuroraCharacter(await files[i].file.text(), player, known, (progress) => update(i, { progress }));
        update(i, { status: "done", report });
      } catch (e) {
        update(i, { status: "failed", error: (e as Error).message });
      }
    }
    setRunning(false);
    qc.invalidateQueries({ queryKey: ["characters"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["players"] }).catch(() => {});
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) setFiles([]);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUpIcon size={16} />
          Import from Aurora
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Aurora</DialogTitle>
          <DialogDescription>
            Pick character files saved by the Aurora builder (.dnd5e). They are rebuilt here as {player}'s characters: class, species,
            background, every choice, level, ability scores, portrait and sources.
          </DialogDescription>
        </DialogHeader>

        <input
          type="file"
          accept=".dnd5e,.xml"
          multiple
          disabled={running}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((file) => ({ file, status: "waiting" })))}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        />

        {files.length > 0 && (
          <ul className="space-y-3">
            {files.map((f, i) => (
              <li key={f.file.name + i} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  {f.status === "importing" && <Spinner className="size-4" />}
                  {f.status === "done" && <CheckIcon className="size-4 text-green-500" />}
                  {f.status === "failed" && <TriangleAlertIcon className="size-4 text-destructive" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{f.report?.name ?? f.file.name}</span>
                  {f.report && (
                    <Link to={`/characters/${f.report.characterId}`} className="text-xs underline" onClick={() => setOpen(false)}>
                      Open
                    </Link>
                  )}
                </div>
                {f.status === "importing" && <p className="mt-1 text-xs text-muted-foreground">{f.progress}</p>}
                {f.status === "failed" && <p className="mt-1 text-xs text-destructive">{f.error}</p>}
                {f.report && (
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    <p>{f.report.picked} choices filled in.</p>
                    {f.report.missing.length > 0 && (
                      <details>
                        <summary>{f.report.missing.length} not in the imported content (homebrew?)</summary>
                        <ul className="mt-1 list-disc pl-5">{f.report.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                      </details>
                    )}
                    {f.report.unmatched.length > 0 && (
                      <details>
                        <summary>{f.report.unmatched.length} choices that did not come up here</summary>
                        <ul className="mt-1 list-disc pl-5">{f.report.unmatched.map((m) => <li key={m}>{m}</li>)}</ul>
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button disabled={running || files.length === 0 || files.every((f) => f.status === "done")} onClick={run}>
            {running ? "Importing…" : `Import ${files.length || ""} ${files.length === 1 ? "character" : "characters"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
