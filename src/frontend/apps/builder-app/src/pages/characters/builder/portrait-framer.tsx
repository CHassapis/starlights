import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { loadPicture, renderFramed } from "@/lib/portrait-render";
import { dragFrame, formatFrame, MAX_SIZE, parseFrame, PORTRAIT_BOX, WHOLE_PICTURE, type PortraitFrame } from "@/lib/rules/portrait-frame";

/** How big the preview is on screen: the sheet's box, a little larger. */
const SCALE = 1.4;

/**
 * Where the portrait sits in the character sheet's portrait box: a slider for its size and dragging to choose the
 * part that shows, previewed exactly as the PDF draws it. Saved with the character (its story's portraitFrame).
 */
export function PortraitFramer({ characterId, portraitUrl }: { characterId: string; portraitUrl: string }) {
  const qc = useQueryClient();
  const storyKey = ["builder", characterId, "story"];
  const story = useQuery({ queryKey: storyKey, queryFn: () => apiClient.get<{ fields: Record<string, string> }>(`/api/characters/${characterId}/story`) });
  const [picture, setPicture] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const [edited, setEdited] = useState<PortraitFrame | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const saved = parseFrame(story.data?.fields.portraitFrame);
  const frame = edited ?? saved ?? WHOLE_PICTURE;

  useEffect(() => {
    let live = true;
    loadPicture(portraitUrl).then(
      (p) => live && setPicture(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [portraitUrl]);

  useEffect(() => {
    if (picture && canvas.current) renderFramed(picture, PORTRAIT_BOX, frame, SCALE * (window.devicePixelRatio || 1), canvas.current);
  }, [picture, frame]);

  async function save(next: PortraitFrame | null) {
    setSaving(true);
    try {
      // the story is saved whole: take the latest, change only the frame
      const { fields } = await apiClient.get<{ fields: Record<string, string> }>(`/api/characters/${characterId}/story`);
      const updated = { ...fields };
      if (next) updated.portraitFrame = formatFrame(next);
      else delete updated.portraitFrame;
      await apiClient.put(`/api/characters/${characterId}/story`, { fields: updated });
      qc.setQueryData(storyKey, { fields: updated });
      qc.invalidateQueries({ queryKey: ["sheet", characterId] }).catch(() => {});
      setEdited(null);
      toast.success("Portrait placed on the sheet");
    } catch (e) {
      toast.error("Could not save it", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <p className="text-sm text-muted-foreground">The portrait could not be loaded for the preview.</p>;
  if (!picture || story.isLoading) return <Spinner className="my-4 size-5" />;
  const move = (dx: number, dy: number) => setEdited(dragFrame(frame, { w: picture.width, h: picture.height }, PORTRAIT_BOX, dx / SCALE, dy / SCALE));
  const changed = edited !== null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <canvas
        ref={canvas}
        aria-label="The portrait as the sheet shows it: drag to move it"
        className="shrink-0 cursor-grab touch-none rounded-sm border bg-white active:cursor-grabbing"
        style={{ width: PORTRAIT_BOX.w * SCALE, height: PORTRAIT_BOX.h * SCALE, maxWidth: "100%" }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          move(e.clientX - drag.current.x, e.clientY - drag.current.y);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <label htmlFor="portrait-size" className="block space-y-1 text-sm">
          <span className="font-medium">Size</span>
          <input
            id="portrait-size"
            type="range"
            min={1}
            max={MAX_SIZE}
            step={0.05}
            value={frame.size}
            onChange={(e) => setEdited({ ...frame, size: Number(e.target.value) })}
            className="block w-full max-w-xs"
          />
          <span className="block text-xs text-muted-foreground">
            {frame.size <= 1 ? "The whole picture fits the box." : "Bigger than the box: drag the picture to choose the part that shows."}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!changed || saving} onClick={() => save(frame)}>
            {saving ? <Spinner /> : <ImageIcon />} Use this on the sheet
          </Button>
          <Button size="sm" variant="outline" disabled={saving || (!saved && !changed)} onClick={() => (saved ? save(null) : setEdited(null))}>
            <RotateCcwIcon /> Whole picture
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">The PDF sheet also ends with a page showing the whole picture.</p>
      </div>
    </div>
  );
}
