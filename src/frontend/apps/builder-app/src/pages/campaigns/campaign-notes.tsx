/**
 * Notes: each player keeps their own (only they read them, not even the DM) and can write to the party; the DM
 * keeps a notebook on the DM side. Notes are kept as the player chosen at the top of the page.
 */
import { NotebookPenIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCampaignActions, type CampaignEntry, type CampaignView, type NoteScope } from "@/lib/api/campaigns";
import { usePlayer } from "@/lib/player";
import { cn } from "@/lib/utils";
import { Prose } from "./campaign-dialogs";
import { textareaClass } from "./campaign-shared";

const scopeOf = (e: CampaignEntry) => (String(e.data.scope ?? "private") as NoteScope);
const authorOf = (e: CampaignEntry) => String(e.data.author ?? "");

function NoteDialog({ campaignId, note, scope, onClose }: { campaignId: string; note: CampaignEntry | null; scope: NoteScope; onClose: () => void }) {
  const actions = useCampaignActions(campaignId);
  const [title, setTitle] = useState(note?.title === "Note" ? "" : (note?.title ?? ""));
  const [body, setBody] = useState(note?.body ?? "");
  const [where, setWhere] = useState<NoteScope>(note ? scopeOf(note) : scope);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{note ? "Edit the note" : where === "dm" ? "A note in the DM's notebook" : "A new note"}</DialogTitle>
          <DialogDescription>
            {where === "dm" ? "Only the DM side shows these." : where === "party" ? "Everyone in the campaign reads it." : "Only you read it. Not even the DM."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Title (optional)" aria-label="Title" />
          <textarea rows={10} className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Note" autoFocus placeholder="What happened, who you met, what to remember…" />
          {where !== "dm" && (
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Who reads it">
              {(["private", "party"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={where === s} onClick={() => setWhere(s)} className={cn("rounded px-3 py-1 text-sm", where === s ? "bg-muted font-medium" : "text-muted-foreground")}>
                  {s === "private" ? "Only me" : "The party"}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={(!body.trim() && !title.trim()) || actions.saveNote.isPending}
              onClick={() =>
                actions.saveNote.mutate(
                  { id: note?.id, title, body, scope: where },
                  { onSuccess: () => (toast.success("Saved"), onClose()), onError: (e) => toast.error("Could not save the note", { description: e.message }) },
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteList({ notes, mine, canDelete, onEdit, onDelete, empty, showAuthor }: { notes: CampaignEntry[]; mine: (n: CampaignEntry) => boolean; canDelete: (n: CampaignEntry) => boolean; onEdit: (n: CampaignEntry) => void; onDelete: (n: CampaignEntry) => void; empty: string; showAuthor?: boolean }) {
  if (notes.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <article key={n.id} className="rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{n.title}</p>
              <p className="text-xs text-muted-foreground">
                {[showAuthor ? authorOf(n) : "", n.occurredOn ?? "", n.updatedAt.slice(0, 10) !== n.occurredOn ? `edited ${n.updatedAt.slice(0, 10)}` : ""].filter(Boolean).join(" · ")}
              </p>
            </div>
            {mine(n) && (
              <Button size="icon-sm" variant="ghost" onClick={() => onEdit(n)} aria-label={`Edit ${n.title}`}>
                <PencilIcon />
              </Button>
            )}
            {canDelete(n) && (
              <Button size="icon-sm" variant="ghost" onClick={() => onDelete(n)} aria-label={`Delete ${n.title}`}>
                <Trash2Icon />
              </Button>
            )}
          </div>
          <Prose text={n.body} className="mt-1.5" />
        </article>
      ))}
    </div>
  );
}

export function CampaignNotes({ view, dmSide }: { view: CampaignView; dmSide: boolean }) {
  const { player } = usePlayer();
  const actions = useCampaignActions(view.campaign.id);
  const [editing, setEditing] = useState<{ note: CampaignEntry | null; scope: NoteScope } | null>(null);
  const notes = view.entries.filter((e) => e.kind === "note").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const me = (player ?? "").trim().toLowerCase();
  const isMine = (n: CampaignEntry) => scopeOf(n) !== "dm" && authorOf(n).trim().toLowerCase() === me && me !== "";
  const own = notes.filter((n) => scopeOf(n) === "private" && isMine(n));
  const party = notes.filter((n) => scopeOf(n) === "party");
  const dmNotes = notes.filter((n) => scopeOf(n) === "dm");
  const remove = (n: CampaignEntry) => {
    if (!window.confirm(`Delete "${n.title}"?`)) return;
    actions.removeNote.mutate(n.id, { onError: (e) => toast.error("Could not delete it", { description: e.message }) });
  };
  const section = (title: string, hint: string, children: ReactNode, add?: () => void) => (
    <section className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-lg tracking-wide">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {add && (
          <Button size="sm" onClick={add}>
            <PlusIcon /> New note
          </Button>
        )}
      </div>
      {children}
    </section>
  );
  return (
    <div className="space-y-8">
      {dmSide &&
        section(
          "DM's notebook",
          "Only the DM side shows these.",
          <NoteList notes={dmNotes} mine={() => true} canDelete={() => true} onEdit={(n) => setEditing({ note: n, scope: "dm" })} onDelete={remove} empty="Nothing yet: plans, reminders, what the players did that you want to come back to." />,
          () => setEditing({ note: null, scope: "dm" }),
        )}
      {player ? (
        section(
          `My notes (${player})`,
          "Only you read these, not even the DM. Lock your player with a password to keep them private on a shared computer.",
          <NoteList notes={own} mine={() => true} canDelete={() => true} onEdit={(n) => setEditing({ note: n, scope: "private" })} onDelete={remove} empty="Nothing yet. Write down names, clues, what you promised whom." />,
          () => setEditing({ note: null, scope: "private" }),
        )
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <NotebookPenIcon className="size-4" /> Choose who you are (your name at the top of the page) to keep your own notes.
        </p>
      )}
      {section(
        "Party notes",
        "Everyone in the campaign reads these.",
        <NoteList notes={party} mine={isMine} canDelete={(n) => isMine(n) || dmSide} onEdit={(n) => setEditing({ note: n, scope: "party" })} onDelete={remove} empty="Nothing shared yet." showAuthor />,
        player ? () => setEditing({ note: null, scope: "party" }) : undefined,
      )}
      {editing && <NoteDialog campaignId={view.campaign.id} note={editing.note} scope={editing.scope} onClose={() => setEditing(null)} />}
    </div>
  );
}
