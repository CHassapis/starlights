/**
 * How the portrait sits in the character sheet's portrait box: its size (1 = the whole picture fits, larger zooms in)
 * and, once it is bigger than the box, which part shows (x and y from -1 to 1: left/top edge to right/bottom edge).
 * Kept in the character's story as "portraitFrame" ("1.6,0.2,-0.5"); the builder's preview and the PDF draw it with
 * the same numbers.
 */

export interface PortraitFrame {
  size: number;
  x: number;
  y: number;
}

/** The sheet's portrait box (Aurora's background page), in PDF points, inside its 2-point margin. */
export const PORTRAIT_BOX = { w: 166.8, h: 169.9 };

export const WHOLE_PICTURE: PortraitFrame = { size: 1, x: 0, y: 0 };
export const MAX_SIZE = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseFrame(text: string | null | undefined): PortraitFrame | null {
  const parts = (text ?? "").split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { size: clamp(parts[0], 1, MAX_SIZE), x: clamp(parts[1], -1, 1), y: clamp(parts[2], -1, 1) };
}

export const formatFrame = (f: PortraitFrame) => [f.size, f.x, f.y].map((n) => Math.round(n * 1000) / 1000).join(",");

/** Where the picture goes in a box of that size: its drawn size and top-left corner (it may run past the box). */
export function placePicture(image: { w: number; h: number }, box: { w: number; h: number }, frame: PortraitFrame) {
  const scale = Math.min(box.w / image.w, box.h / image.h) * clamp(frame.size, 1, MAX_SIZE);
  const w = image.w * scale;
  const h = image.h * scale;
  const slackX = Math.max(0, w - box.w);
  const slackY = Math.max(0, h - box.h);
  return { w, h, left: (box.w - w) / 2 - (clamp(frame.x, -1, 1) * slackX) / 2, top: (box.h - h) / 2 - (clamp(frame.y, -1, 1) * slackY) / 2, slackX, slackY };
}

/** The frame after dragging the picture by dx, dy (in the same units as the box): it follows the pointer. */
export function dragFrame(frame: PortraitFrame, image: { w: number; h: number }, box: { w: number; h: number }, dx: number, dy: number): PortraitFrame {
  const { slackX, slackY } = placePicture(image, box, frame);
  return {
    size: frame.size,
    x: slackX > 0 ? clamp(frame.x - (2 * dx) / slackX, -1, 1) : 0,
    y: slackY > 0 ? clamp(frame.y - (2 * dy) / slackY, -1, 1) : 0,
  };
}
