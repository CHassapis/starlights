/**
 * Draws a PDF's pages as pictures with pdf.js, for showing the character sheet on screen exactly as it prints.
 * The legacy build also runs on older phones (iOS before 17.4). pdf.js is loaded on first use, so it stays out of
 * the main bundle. The sheet's one non-embedded font (ZapfDingbats, for the proficiency marks) comes from the
 * standard fonts that vite.config copies to /pdfjs/standard_fonts/.
 */
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/** Renders each page `cssWidth` pixels wide (sharp on high-density screens, up to 2×), as object URLs, in order. */
export async function renderPdfPages(bytes: Uint8Array, cssWidth: number, onPage: (index: number, url: string, pageCount: number) => void, signal: AbortSignal): Promise<void> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // pdf.js takes ownership of the buffer it is given, so hand it a copy
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/` });
  signal.addEventListener("abort", () => void task.destroy());
  const doc = await task.promise;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 1; i <= doc.numPages && !signal.aborted; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: (cssWidth / page.getViewport({ scale: 1 }).width) * density });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    // let the browser free the canvas's memory now rather than at the end
    canvas.width = canvas.height = 0;
    page.cleanup();
    if (blob && !signal.aborted) onPage(i - 1, URL.createObjectURL(blob), doc.numPages);
  }
  await doc.destroy();
}
