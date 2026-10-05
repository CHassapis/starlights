import { LockIcon, PlusIcon, ScrollTextIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCampaignActions, useCampaigns } from "@/lib/api/campaigns";
import { usePlayer } from "@/lib/player";
import { textareaClass } from "./campaign-dialogs";

/** The campaigns: everyone sees that they exist; one with a password shows only its name until it is given. */
export function CampaignsPage() {
  const { data, isLoading } = useCampaigns();
  const [creating, setCreating] = useState(false);
  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-3xl tracking-wide">Campaigns</h1>
        {data && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <PlusIcon /> New campaign
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Each campaign keeps its sessions, people and places, quests, maps, magic items and gold. The DM writes it; players read what the DM reveals. Anyone can start one and be its DM.
      </p>
      {isLoading && <Spinner className="mx-auto size-5" />}
      {data && data.campaigns.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No campaigns yet. Start one with “New campaign”.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.campaigns.map((c) => (
          <Link key={c.id} to={`/campaigns/${c.id}`} className="overflow-hidden rounded-lg border hover:bg-muted/40">
            {c.coverUrl ? (
              <img src={c.coverUrl} alt="" className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-36 items-center justify-center bg-muted">
                <ScrollTextIcon className="size-8 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-1 p-4">
              <p className="flex items-center gap-2 font-heading text-lg">
                {c.name}
                {c.locked && <LockIcon className="size-4 text-muted-foreground" aria-label="Has a password" />}
                {c.dm && <span className="ms-auto rounded-full bg-primary/15 px-2 py-0.5 font-sans text-xs text-primary">You run this</span>}
              </p>
              {c.dmName && <p className="text-xs text-muted-foreground">DM: {c.dmName}</p>}
              {c.canOpen ? (
                <>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UsersIcon className="size-3.5" /> {c.party.length} in the party
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Has a password: open it to read it.</p>
              )}
            </div>
          </Link>
        ))}
      </div>
      {creating && <NewCampaign admin={data?.dm === true} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCampaign({ onClose, admin }: { onClose: () => void; admin: boolean }) {
  const navigate = useNavigate();
  const { create } = useCampaignActions();
  const { player } = usePlayer();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dmName, setDmName] = useState(player ?? "");
  const [dmPassword, setDmPassword] = useState("");
  const passwordOk = dmPassword.length >= 6 || (admin && dmPassword.length === 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Players add their characters from their character's page; you can also choose the party in the campaign's settings.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="Curse of Strahd" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            Description (players see it)
            <textarea rows={4} className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            Your name as the DM (everyone sees it)
            <Input value={dmName} onChange={(e) => setDmName(e.target.value)} maxLength={100} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            DM password
            <span className="block text-xs font-normal text-muted-foreground">
              You run the campaign from this browser straight away. On another phone or computer, open the campaign and give this password (“I'm the DM”). At least 6 characters; keep it from your players.
              {admin ? " As the site's admin you can leave it empty." : ""}
            </span>
            <Input type="password" autoComplete="new-password" value={dmPassword} onChange={(e) => setDmPassword(e.target.value)} />
          </label>
          <Button
            className="w-full"
            disabled={!name.trim() || !passwordOk || create.isPending}
            onClick={() =>
              create.mutate(
                { name, description, party: [], dmName, dmPassword },
                { onSuccess: (c) => navigate(`/campaigns/${c.id}`), onError: (e) => toast.error("Could not create it", { description: e.message }) },
              )
            }
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
