import { LockIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePlayers, useUnlockPlayer } from "@/lib/api/builder";
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
  const unlock = useUnlockPlayer();
  const [name, setName] = useState("");
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const players = data?.players ?? [];
  const taken = players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase() && p.locked);

  function choose(playerName: string, locked: boolean) {
    if (!locked) {
      setPlayer(playerName);
      return;
    }
    setUnlocking(playerName);
    setPassword("");
    unlock.reset();
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl tracking-wide">Who's playing?</CardTitle>
          <CardDescription>Pick your name to see your characters. This browser remembers you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {players.length > 0 && (
            <div className="grid gap-2">
              {players.map((p) => (
                <div key={p.name} className="space-y-2">
                  <Button variant="outline" className="h-auto w-full justify-between py-3" onClick={() => choose(p.name, p.locked)}>
                    <span className="flex items-center gap-2">
                      {p.locked ? <LockIcon className="size-4" /> : <UserIcon className="size-4" />}
                      {p.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.locked ? "password" : `${p.characters} ${p.characters === 1 ? "character" : "characters"}`}
                    </span>
                  </Button>
                  {unlocking === p.name && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        unlock.mutate({ name: p.name, password }, { onSuccess: () => setPlayer(p.name) });
                      }}
                    >
                      <Input
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        placeholder={`Password for ${p.name}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <Button type="submit" disabled={!password || unlock.isPending}>
                        Unlock
                      </Button>
                    </form>
                  )}
                  {unlocking === p.name && unlock.isError && <p className="text-sm text-destructive">That password is not right.</p>}
                </div>
              ))}
            </div>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !taken) setPlayer(name);
            }}
          >
            <label htmlFor="new-player" className="text-sm font-medium">
              {players.length > 0 ? "Someone new?" : "Your name"}
            </label>
            <div className="flex gap-2">
              <Input id="new-player" value={name} maxLength={64} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={!name.trim() || taken}>
                Continue
              </Button>
            </div>
            {taken && <p className="text-sm text-muted-foreground">That name is locked; pick it from the list above.</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
