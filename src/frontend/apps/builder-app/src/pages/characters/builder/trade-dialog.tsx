import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { usePartyMembers } from "@/lib/api/campaigns";
import { useTrade } from "@/lib/api/inventory";
import { COIN_NAMES, COINS, type Coin } from "@/lib/rules/items";

export interface TradeItem {
  id: string;
  name: string;
  quantity: number;
}

/**
 * Hands an item (or some of a stack) and/or coins to another character of a campaign this one plays in. The item
 * leaves this character's equipment at once and shows up, unequipped, in the other's; the campaign's Gold tab notes it.
 */
export function TradeDialog({ characterId, item, purse, onClose }: { characterId: string; item: TradeItem | null; purse: Partial<Record<Coin, number>>; onClose: () => void }) {
  const party = usePartyMembers(characterId);
  const trade = useTrade(characterId);
  const choices = party.choices;
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [coins, setCoins] = useState<Partial<Record<Coin, number>>>({});
  const chosen = to || choices[0]?.key || "";
  const giving = Object.values(coins).some((n) => (n ?? 0) > 0);
  const tooMany = COINS.some((c) => (coins[c] ?? 0) > (purse[c] ?? 0));

  function give() {
    const [campaignId, toCharacterId] = chosen.split("|");
    trade.mutate(
      { campaignId, toCharacterId, itemId: item?.id ?? null, quantity: item ? quantity : 0, coins: Object.fromEntries(Object.entries(coins).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number> },
      {
        onSuccess: (r) => {
          toast.success(`Gave ${r.given} to ${choices.find((c) => c.key === chosen)?.name ?? "them"}`);
          onClose();
        },
        onError: (e) => toast.error("Could not give it", { description: e.message.includes("403") ? "You can't change this character (its player has a password)." : e.message }),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? `Give ${item.name}` : "Give coins"}</DialogTitle>
          <DialogDescription>To another character in one of your campaigns. It arrives in their equipment, unequipped.</DialogDescription>
        </DialogHeader>
        {party.isLoading ? (
          <Spinner className="mx-auto my-6 size-5" />
        ) : choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody to give it to yet: this character needs to be in a campaign with the others (Campaigns button at the top).</p>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Give to</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={chosen} onChange={(e) => setTo(e.target.value)}>
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                    {new Set(choices.map((x) => x.campaignId)).size > 1 ? ` (${c.campaignName})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {item && item.quantity > 1 && (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">How many (of {item.quantity})</span>
                <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(Math.min(item.quantity, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))} className="w-24" />
              </label>
            )}
            <div className="space-y-1">
              <p className="text-sm font-medium">{item ? "And coins (optional)" : "Coins"}</p>
              <div className="grid grid-cols-5 gap-2">
                {COINS.map((c) => (
                  <label key={c} className="space-y-1 text-center text-xs text-muted-foreground">
                    {COIN_NAMES[c]}
                    <Input
                      aria-label={`${COIN_NAMES[c]} to give`}
                      inputMode="numeric"
                      value={coins[c] ?? ""}
                      placeholder="0"
                      onChange={(e) => setCoins({ ...coins, [c]: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                      className="text-center"
                    />
                    <span className="block text-[10px]">has {purse[c] ?? 0}</span>
                  </label>
                ))}
              </div>
              {tooMany && <p className="text-xs text-destructive">That's more than there is in the purse.</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!chosen || trade.isPending || tooMany || (!item && !giving)} onClick={give}>
            {trade.isPending && <Spinner />} Give
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
