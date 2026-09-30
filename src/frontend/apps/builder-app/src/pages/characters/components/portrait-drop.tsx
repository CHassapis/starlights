import { CameraIcon, ImagePlusIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { firstImage, usePictureDrop, usePortraitUpload } from "@/lib/picture-drop";
import { cn } from "@/lib/utils";

/**
 * Wraps a character card: drop a picture on the card to make it the portrait, or use the camera button in its
 * corner (always shown on phones, on hover otherwise).
 */
export function PortraitDrop({ characterId, name, hasPortrait, children }: { characterId: string; name: string; hasPortrait: boolean; children: ReactNode }) {
  const upload = usePortraitUpload(characterId);
  const { over, handlers } = usePictureDrop(upload.send);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div {...handlers} className={cn("relative rounded-xl", over && "ring-4 ring-primary")}>
      {children}
      {!hasPortrait && !over && (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-1 text-center text-[11px] text-muted-foreground">
          <ImagePlusIcon className="size-5" />
          drop a portrait here
        </div>
      )}
      <button
        type="button"
        title={`Change ${name}'s portrait`}
        onClick={() => input.current?.click()}
        className="absolute start-3 top-3 flex size-7 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black/80 sm:hidden sm:group-hover:flex"
      >
        {upload.isPending ? <Spinner className="size-3.5" /> : <CameraIcon className="size-3.5" />}
        <span className="sr-only">Change portrait</span>
      </button>
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/30 text-sm font-medium text-white">
          Drop to set the portrait
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = firstImage(e.target.files);
          e.target.value = "";
          if (file) upload.send(file);
        }}
      />
    </div>
  );
}
