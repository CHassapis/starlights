import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { forgetAdminToken, isAdmin, saveAdminToken } from "@/lib/player";
import { cn } from "@/lib/utils";

/**
 * The master admin password: opens every locked player and campaign and allows homebrew uploads, on this browser.
 */
export function AdminButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(isAdmin);

  async function unlock() {
    setBusy(true);
    try {
      const { token } = await apiClient.post<{ password: string }, { token: string }>("/api/admin/unlock", { password });
      saveAdminToken(token);
      setAdmin(true);
      setOpen(false);
      setPassword("");
      toast.success("Admin unlocked on this browser");
      qc.invalidateQueries().catch(() => {});
    } catch {
      toast.error("That password is not right");
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    forgetAdminToken();
    setAdmin(false);
    setOpen(false);
    toast.success("Admin locked again");
    qc.invalidateQueries().catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title={admin ? "Admin (unlocked)" : "Admin"}
          className={cn("rounded-md p-2 hover:bg-muted", admin && "text-amber-500")}
        >
          <KeyRoundIcon className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admin</DialogTitle>
          <DialogDescription>
            {admin
              ? "This browser is unlocked as admin: every player and campaign is open, and homebrew can be added."
              : "The master admin password opens every locked player and campaign and lets you add homebrew."}
          </DialogDescription>
        </DialogHeader>
        {admin ? (
          <DialogFooter>
            <Button variant="outline" onClick={lock}>
              Lock admin on this browser
            </Button>
          </DialogFooter>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) unlock();
            }}
          >
            <Input type="password" autoFocus autoComplete="current-password" placeholder="Master password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <DialogFooter>
              <Button type="submit" disabled={!password || busy}>
                Unlock
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
