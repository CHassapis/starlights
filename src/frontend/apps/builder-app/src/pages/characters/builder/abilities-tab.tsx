import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { refreshCharacter } from "@/lib/api/builder";
import { cn } from "@/lib/utils";

interface AbilityScore {
  abilityScoreId: string;
  name: string;
  abbreviation: string;
  baseScore: number;
  additionalScore: number;
  calculatedScore: number;
  calculatedModifier: number;
}

type Method = "manual" | "array" | "pointbuy";

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
// point buy: score -> cost, 27 points to spend
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINTS = 27;

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Base ability scores by manual entry, the standard array or point buy; bonuses from species, background, feats
 * and ability score improvements are added by the builder.
 */
export function AbilitiesTab({ characterId }: { characterId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["builder", characterId, "abilities"],
    queryFn: () => apiClient.get<{ abilityScores: AbilityScore[] }>(`/api/characters/${characterId}/ability-scores`),
  });
  const [method, setMethod] = useState<Method>("manual");

  const setBase = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => apiClient.post(`/api/characters/${characterId}/ability-scores/${id}/base`, { value }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["builder", characterId, "abilities"] }).catch(() => {});
      refreshCharacter(qc, characterId);
    },
    onError: (e) => toast.error("Could not change the score", { description: e.message }),
  });

  if (isLoading || !data) return <Spinner className="mx-auto my-8 size-5" />;
  const scores = data.abilityScores;

  const spent = scores.reduce((sum, a) => sum + (POINT_COST[a.baseScore] ?? 99), 0);
  const pointBuyValid = scores.every((a) => a.baseScore in POINT_COST);
  const usedArray = scores.map((a) => a.baseScore);

  function apply(values: number[]) {
    scores.forEach((a, i) => {
      if (a.baseScore !== values[i]) setBase.mutate({ id: a.abilityScoreId, value: values[i] });
    });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["manual", "Manual"],
            ["array", "Standard array"],
            ["pointbuy", "Point buy"],
          ] as [Method, string][]
        ).map(([key, label]) => (
          <Button key={key} size="sm" variant={method === key ? "secondary" : "outline"} onClick={() => setMethod(key)}>
            {label}
          </Button>
        ))}
        {method === "array" && (
          <Button size="sm" variant="ghost" onClick={() => apply(STANDARD_ARRAY)}>
            Reset to 15, 14, 13, 12, 10, 8
          </Button>
        )}
        {method === "pointbuy" && (
          <>
            <Button size="sm" variant="ghost" onClick={() => apply(scores.map(() => 8))}>
              Start from 8s
            </Button>
            <span className={cn("ms-auto text-sm", pointBuyValid && spent <= POINTS ? "text-muted-foreground" : "text-destructive")}>
              {pointBuyValid ? `${POINTS - spent} of ${POINTS} points left` : "Point buy uses scores from 8 to 15"}
            </span>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scores.map((a) => {
          const bonus = a.calculatedScore - a.baseScore;
          return (
            <div key={a.abilityScoreId} className="rounded-lg border bg-background/60 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-heading text-lg tracking-wide">{a.name}</h3>
                <span className="text-xs text-muted-foreground">{a.abbreviation}</span>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">Base</div>
                  {method === "manual" && (
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      defaultValue={a.baseScore}
                      key={a.baseScore}
                      onBlur={(e) => {
                        const value = Math.max(1, Math.min(30, Number(e.target.value) || a.baseScore));
                        if (value !== a.baseScore) setBase.mutate({ id: a.abilityScoreId, value });
                      }}
                      className="w-20"
                    />
                  )}
                  {method === "array" && (
                    <select
                      value={a.baseScore}
                      onChange={(e) => setBase.mutate({ id: a.abilityScoreId, value: Number(e.target.value) })}
                      className="h-9 w-20 rounded-md border bg-background px-2 text-sm"
                    >
                      {[...new Set([a.baseScore, ...STANDARD_ARRAY])].sort((x, y) => y - x).map((v) => (
                        <option key={v} value={v} disabled={v !== a.baseScore && usedArray.filter((u) => u === v).length >= STANDARD_ARRAY.filter((s) => s === v).length}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                  {method === "pointbuy" && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Lower ${a.name}`}
                        disabled={a.baseScore <= 8 || setBase.isPending}
                        onClick={() => setBase.mutate({ id: a.abilityScoreId, value: a.baseScore - 1 })}
                      >
                        <MinusIcon />
                      </Button>
                      <span className="w-8 text-center">{a.baseScore}</span>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Raise ${a.name}`}
                        disabled={a.baseScore >= 15 || !pointBuyValid || spent - (POINT_COST[a.baseScore] ?? 0) + (POINT_COST[a.baseScore + 1] ?? 99) > POINTS || setBase.isPending}
                        onClick={() => setBase.mutate({ id: a.abilityScoreId, value: a.baseScore + 1 })}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Bonus</div>
                  <div className="text-lg">{bonus ? fmt(bonus) : "–"}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="font-heading text-3xl">{a.calculatedScore}</div>
                </div>
                <div className="rounded-full border px-3 py-1 text-lg">{fmt(a.calculatedModifier)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Bonuses come from your species, background, feats and ability score improvements in the Build tab.</p>
    </div>
  );
}
