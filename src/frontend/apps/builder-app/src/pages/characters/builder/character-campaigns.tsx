import { LockIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { unlockCampaign, useCampaignMembership, useCampaigns } from "@/lib/api/campaigns";
import { PlayerPasswordDialog } from "../player-password-dialog";

/**
 * The character's campaigns: join one (giving its password if it has one) or leave, and protect the player's
 * characters with a password. Joining needs the right to change this character, as everything else here does.
 */
export function CharacterCampaigns({ characterId, playerName }: { characterId: string; playerName?: string | null }) {
  const { data, refetch } = useCampaigns();
  const { join, leave } = useCampaignMembership();
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const campaigns = data?.campaigns ?? [];
  const mine = campaigns.filter((c) => c.party.includes(characterId));
  const others = campaigns.filter((c) => !c.party.includes(characterId));
  const failed = (e: Error) => toast.error(e.message.includes("403") ? "You cannot change this character's campaigns (its player has a password)." : "Could not do it", { description: e.message });

  async function joinCampaign(id: string, locked: boolean) {
    try {
      if (locked) await unlockCampaign(id, passwords[id] ?? "");
      await join.mutateAsync({ campaignId: id, characterId });
      await refetch();
      toast.success("Joined the campaign");
    } catch (e) {
      failed(e as Error);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <ScrollTextIcon size={16} />
          Campaigns{mine.length > 0 ? ` (${mine.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Campaigns</DialogTitle>
          <DialogDescription>Add this character to your DM's campaign, so it shows in the party and can be given items and gold.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {mine.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">In</h3>
              {mine.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Link to={`/campaigns/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                    {c.name}
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto"
                    onClick={() => leave.mutate({ campaignId: c.id, characterId }, { onSuccess: () => toast.success("Left the campaign"), onError: failed })}
                  >
                    Leave
                  </Button>
                </div>
              ))}
            </section>
          )}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Join</h3>
            {others.length === 0 && <p className="text-sm text-muted-foreground">{campaigns.length === 0 ? "No campaigns yet: your DM starts one." : "Nothing else to join."}</p>}
            {others.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                <span className="flex items-center gap-1.5 font-medium">
                  {c.name}
                  {c.locked && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Has a password" />}
                </span>
                {c.locked && !c.canOpen && (
                  <Input
                    type="password"
                    className="h-8 w-40"
                    placeholder="Campaign password"
                    aria-label={`Password of ${c.name}`}
                    value={passwords[c.id] ?? ""}
                    onChange={(e) => setPasswords({ ...passwords, [c.id]: e.target.value })}
                  />
                )}
                <Button size="sm" className="ms-auto" disabled={join.isPending || (c.locked && !c.canOpen && !passwords[c.id])} onClick={() => joinCampaign(c.id, c.locked && !c.canOpen)}>
                  Join
                </Button>
              </div>
            ))}
          </section>
          {playerName && (
            <section className="space-y-2 rounded-md border p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <LockIcon className="size-4" /> Protect your characters
              </h3>
              <p className="text-xs text-muted-foreground">
                A password on {playerName} keeps all of {playerName}'s characters for you: others can neither open nor change them, nor move them in or out of campaigns.
              </p>
              <PlayerPasswordDialog player={playerName} />
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
