import { useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useUploadPortrait } from "@/lib/api/builder";
import { shrinkImage } from "@/lib/image";

/** The first image among dropped or picked files. */
export function firstImage(files: FileList | null | undefined): File | undefined {
  return Array.from(files ?? []).find((f) => f.type.startsWith("image/"));
}

/**
 * Drag-and-drop of a picture onto an element: spread `handlers` on it and use `over` to highlight it while a file
 * is dragged over. Only file drags count, so dragging text around the page does nothing.
 */
export function usePictureDrop(onFile: (file: File) => void) {
  const [over, setOver] = useState(false);
  const handlers = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setOver(false);
      const file = firstImage(e.dataTransfer.files);
      if (file) onFile(file);
      else toast.error("That is not a picture");
    },
  };
  return { over, handlers };
}

/** Shrinks a picture in the browser and sets it as the character's portrait, with a message either way. */
export function usePortraitUpload(characterId: string) {
  const upload = useUploadPortrait(characterId);
  async function send(file: File) {
    try {
      const data = await shrinkImage(file);
      upload.mutate(data, {
        onSuccess: () => toast.success("Portrait updated"),
        onError: (err) => toast.error("Could not upload the portrait", { description: err.message }),
      });
    } catch (err) {
      toast.error("Could not read that picture", { description: (err as Error).message });
    }
  }
  return { send, isPending: upload.isPending };
}
