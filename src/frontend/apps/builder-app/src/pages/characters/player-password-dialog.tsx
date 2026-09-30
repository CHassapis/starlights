import { LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePlayers, useSetPlayerPassword } from "@/lib/api/builder";

/**
 * Lock the current player's characters with a password, change it, or remove it.
 */
export function PlayerPasswordDialog({ player }: { player: string }) {
  const { data } = usePlayers();
  const setPassword = useSetPlayerPassword();
  const [open, setOpen] = useState(false);
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");

  const locked = data?.players.some((p) => p.locked && p.name.toLowerCase() === player.toLowerCase()) ?? false;
  const valid = password.length >= 6 && password === confirm;

  function save(value: string) {
    setPassword.mutate(
      { name: player, password: value },
      {
        onSuccess: () => {
          toast.success(value ? "Your characters are locked with this password" : "Password removed");
          setOpen(false);
          setPasswordValue("");
          setConfirm("");
        },
        onError: (e) => toast.error("Could not change the password", { description: e.message }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 underline">
          <LockIcon className="size-3.5" />
          {locked ? "Change password" : "Lock with a password"}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locked ? "Change password" : "Lock your characters"}</DialogTitle>
          <DialogDescription>
            Others will need this password to see or change {player}'s characters. It is stored hashed; nobody can read it back, so remember it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save(password);
          }}
        >
          <Input type="password" autoComplete="new-password" placeholder="New password (at least 6 characters)" value={password} onChange={(e) => setPasswordValue(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder="Repeat the password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm.length > 0 && password !== confirm && <p className="text-sm text-destructive">The passwords do not match.</p>}
          <DialogFooter className="gap-2">
            {locked && (
              <Button type="button" variant="ghost" disabled={setPassword.isPending} onClick={() => save("")}>
                Remove password
              </Button>
            )}
            <Button type="submit" disabled={!valid || setPassword.isPending}>
              {locked ? "Change password" : "Lock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
