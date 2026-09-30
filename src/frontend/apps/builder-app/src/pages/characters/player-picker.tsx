import { UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePlayers } from "@/lib/api/builder";
import { usePlayer } from "@/lib/player";

/**
 * Shows the "who's playing?" picker until this browser has a player name, then the page.
 */
export function PlayerGate({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  return player ? <>{children}</> : <PlayerPicker />;
}

export function PlayerPicker() {
  const { setPlayer } = usePlayer();
  const { data } = usePlayers();
  const [name, setName] = useState("");

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl tracking-wide">Who's playing?</CardTitle>
          <CardDescription>Pick your name to see your characters. No password needed; this browser remembers you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {data && data.players.length > 0 && (
            <div className="grid gap-2">
              {data.players.map((p) => (
                <Button key={p.name} variant="outline" className="h-auto justify-between py-3" onClick={() => setPlayer(p.name)}>
                  <span className="flex items-center gap-2">
                    <UserIcon className="size-4" />
                    {p.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.characters} {p.characters === 1 ? "character" : "characters"}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) setPlayer(name);
            }}
          >
            <label htmlFor="new-player" className="text-sm font-medium">
              {data && data.players.length > 0 ? "Someone new?" : "Your name"}
            </label>
            <div className="flex gap-2">
              <Input id="new-player" value={name} maxLength={64} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={!name.trim()}>
                Continue
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
