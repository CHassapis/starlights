import { buildAuroraSheet, defenseLines, detailsValues, equipmentValues } from "@/lib/aurora-sheet";
import { ArrowLeftIcon, DownloadIcon, FileTextIcon, PrinterIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSheetData } from "@/lib/api/sheet";
import { renderPdfPages } from "@/lib/pdf-view";

/*
 * The character sheet: Aurora's own sheet templates filled in (lib/aurora-sheet), shown page by page exactly as
 * they print. The same PDF is what "View PDF" opens and "Download PDF" saves.
 */

/** US Letter at 96 dpi: the width the pages are drawn at, and their shape. */
const PAGE_WIDTH = 816;
const PAGE_RATIO = "612 / 792";

export function CharacterSheetPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useSheetData(id);
  // the sheet data is rebuilt on every render, so the PDF is made again only when its contents change
  const signature = data ? JSON.stringify(data) : "";
  const [pdf, setPdf] = useState<{ signature: string; bytes?: Uint8Array; error?: string }>();
  const [pages, setPages] = useState<{ bytes: Uint8Array; urls: string[]; count: number }>();

  useEffect(() => {
    if (!data || pdf?.signature === signature) return;
    let current = true;
    buildAuroraSheet(data).then(
      (bytes) => current && setPdf({ signature, bytes }),
      (e: Error) => current && setPdf({ signature, error: e.message }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `data`
  }, [signature]);

  const bytes = pdf?.signature === signature ? pdf.bytes : undefined;
  useEffect(() => {
    if (!bytes) return;
    const abort = new AbortController();
    const urls: string[] = [];
    renderPdfPages(
      bytes,
      PAGE_WIDTH,
      (index, url, count) => {
        urls[index] = url;
        setPages({ bytes, urls: [...urls], count });
      },
      abort.signal,
    ).catch((e: Error) => {
      if (!abort.signal.aborted) toast.error("Could not show the sheet", { description: e.message });
    });
    return () => {
      abort.abort();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [bytes]);

  // "view" opens the PDF in the browser's PDF viewer; otherwise it is saved
  function openPdf(view: boolean) {
    if (!data || !bytes) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    if (view) {
      window.open(url, "_blank");
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.name.replace(/[^\w\- ]+/g, "").trim() || "character"}.pdf`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (isLoading) return <Spinner className="mx-auto my-24 size-6" />;
  if (error || !data)
    return (
      <p className="py-24 text-center text-muted-foreground">
        {(error as { status?: number } | null)?.status === 401 ? "This character's player locked their characters with a password." : "This character could not be loaded."}
      </p>
    );

  // ?fields: the values the PDF writes, by Aurora's field names, for comparing with Aurora's own sheets
  const fields = new URLSearchParams(window.location.search).has("fields")
    ? JSON.stringify({ fields: { ...detailsValues(data), ...equipmentValues(data), details_resistances: defenseLines(data).map(([t, l]) => `${t}. ${l.join(", ")}`).join("\n") }, spellPages: data.spellPages, itemCards: data.itemCards.map((c) => ({ ...c, html: undefined })), cardSpells: data.cardSpells.map((s) => s.name) })
    : null;
  const shown = pages && pages.bytes === bytes ? pages : undefined;
  const failed = pdf?.signature === signature ? pdf.error : undefined;

  return (
    <div className="min-h-screen bg-neutral-300 py-6 print:bg-white print:py-0">
      <style>{"@media print { @page { size: letter; margin: 0 } .sheet-page { break-after: page } .sheet-page:last-of-type { break-after: auto } }"}</style>
      {fields && (
        <pre id="sheet-fields" hidden>
          {fields}
        </pre>
      )}
      <div className="mx-auto mb-4 flex max-w-[816px] flex-wrap items-center gap-2 px-4 print:hidden">
        <Button variant="secondary" asChild>
          <Link to={`/characters/${id}`}>
            <ArrowLeftIcon /> Back to the builder
          </Link>
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => window.print()} disabled={!shown || shown.urls.length < shown.count}>
          <PrinterIcon /> Print
        </Button>
        <Button variant="secondary" onClick={() => openPdf(true)} disabled={!bytes}>
          <FileTextIcon /> View PDF
        </Button>
        <Button onClick={() => openPdf(false)} disabled={!bytes}>
          {bytes ? <DownloadIcon /> : <Spinner />} Download PDF
        </Button>
      </div>
      {failed ? (
        <p className="py-24 text-center text-muted-foreground">Could not make the sheet: {failed}</p>
      ) : (
        <div className="mx-auto flex max-w-[816px] flex-col gap-6 px-2 sm:px-0 print:max-w-none print:gap-0 print:px-0">
          {Array.from({ length: shown?.count || 1 }, (_, i) =>
            shown?.urls[i] ? (
              <img key={i} src={shown.urls[i]} alt={`${data.name}'s character sheet, page ${i + 1}`} className="sheet-page w-full bg-white shadow-lg print:shadow-none" style={{ aspectRatio: PAGE_RATIO }} />
            ) : (
              <div key={i} className="flex w-full items-center justify-center bg-white shadow-lg print:hidden" style={{ aspectRatio: PAGE_RATIO }}>
                <Spinner className="size-6" />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
