/**
 * Save and Discard for the builder. Opening the builder takes a snapshot of the character; what the player changes
 * shows at once (the sheet, the simulator), but is kept for good only when they press Save. Discard puts the character
 * back as it was when the builder was opened. Leaving the builder with unsaved changes asks which.
 */
import { useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { useBuilderSession, useBuilderSessionActions } from "@/lib/api/builder";
import { unlockTokenHeader } from "@/lib/player";

const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function SaveBar({ characterId, name }: { characterId: string; name: string }) {
  const session = useBuilderSession(characterId);
  const { start, save, discard } = useBuilderSessionActions(characterId);
  const [confirming, setConfirming] = useState(false);
  const changed = session.data?.changed ?? false;
  const busy = save.isPending || discard.isPending;
  const startSession = start.mutate;

  // the snapshot is taken when the builder opens (one already waiting to be saved or discarded is kept)
  useEffect(() => {
    startSession(undefined, { onError: (e) => toast.error("Could not start editing safely", { description: e.message }) });
  }, [characterId, startSession]);

  // leaving the builder: the server drops the snapshot when nothing changed (so that later changes from elsewhere, an
  // item the DM gives, are never taken for unsaved builder changes) and keeps it when something did
  useEffect(() => {
    const close = (beacon: boolean) => {
      if (!beacon) {
        apiClient.post(`/api/characters/${characterId}/builder/session/close`, {}).catch(() => {});
        return;
      }
      const tokens = unlockTokenHeader();
      fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/characters/${characterId}/builder/session/close`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(tokens ? { "X-Player-Token": tokens } : {}) },
        body: "{}",
      }).catch(() => {});
    };
    const onHide = () => close(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      close(false);
    };
  }, [characterId]);

  // leaving with unsaved changes: within the app this asks; closing the tab gets the browser's own question
  const blocker = useBlocker(({ currentLocation, nextLocation }) => changed && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!changed) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  const doSave = (then?: () => void) =>
    save.mutate(undefined, {
      onSuccess: () => {
        toast.success(`${name || "The character"} is saved`);
        if (then) then();
        // still editing: a new snapshot from here
        else startSession();
      },
      onError: (e) => toast.error("Could not save", { description: e.message }),
    });
  const doDiscard = (then?: () => void) =>
    discard.mutate(undefined, {
      onSuccess: () => {
        toast.success("Changes discarded", { description: `Back as it was at ${time(session.data?.since)}.` });
        setConfirming(false);
        if (then) then();
        // still editing: a new snapshot from here
        else startSession();
      },
      onError: (e) => toast.error("Could not discard the changes", { description: e.message }),
    });

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] backdrop-blur">
        <div className="container mx-auto flex flex-wrap items-center gap-2 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm">
            {changed ? (
              <>
                <span className="font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span>
                <span className="text-muted-foreground"> since {time(session.data?.since)}: nothing is kept for good until you save.</span>
              </>
            ) : (
              <span className="text-muted-foreground">No unsaved changes.</span>
            )}
          </p>
          <Button variant="outline" size="sm" disabled={!changed || busy} onClick={() => setConfirming(true)}>
            Discard changes
          </Button>
          <Button size="sm" disabled={!changed || busy} onClick={() => doSave()}>
            Save
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard the changes?</DialogTitle>
            <DialogDescription>
              {name || "The character"} goes back to how it was at {time(session.data?.since)}. Everything changed since (choices, levels, abilities, equipment, spells,
              story) is undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => doDiscard()}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.state === "blocked"} onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save the changes to {name || "this character"}?</DialogTitle>
            <DialogDescription>You changed the character since {time(session.data?.since)}. Save keeps the changes; Discard puts it back as it was.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>
              Keep editing
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => doDiscard(() => blocker.state === "blocked" && blocker.proceed())}>
              Discard
            </Button>
            <Button disabled={busy} onClick={() => doSave(() => blocker.state === "blocked" && blocker.proceed())}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
