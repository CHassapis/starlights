/**
 * Draws a portrait the way the character sheet shows it: the picture placed in the sheet's portrait box by its frame
 * (size and which part shows), on white. The builder's preview and the PDF use the same drawing.
 */
import { placePicture, type PortraitFrame } from "@/lib/rules/portrait-frame";

/** The picture at a URL, decoded (same-origin uploads and the app's own portraits). */
export async function loadPicture(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob());
}

/** A canvas of the box's shape (pixelsPerUnit pixels per box unit) with the framed picture drawn in it. */
export function renderFramed(picture: CanvasImageSource & { width: number; height: number }, box: { w: number; h: number }, frame: PortraitFrame, pixelsPerUnit: number, canvas = document.createElement("canvas")) {
  canvas.width = Math.round(box.w * pixelsPerUnit);
  canvas.height = Math.round(box.h * pixelsPerUnit);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const p = placePicture({ w: picture.width, h: picture.height }, box, frame);
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, p.left * pixelsPerUnit, p.top * pixelsPerUnit, p.w * pixelsPerUnit, p.h * pixelsPerUnit);
  return canvas;
}

export async function canvasJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/jpeg", 0.9));
  return blob.arrayBuffer();
}
