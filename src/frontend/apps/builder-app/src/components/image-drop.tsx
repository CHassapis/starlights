import { ImagePlusIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { firstImage, usePictureDrop } from "@/lib/picture-drop";
import { cn } from "@/lib/utils";

/**
 * A picture slot: drop an image on it, or click it to choose one. Shows the current picture with Change and
 * Remove underneath. The parent uploads the file it gets.
 */
export function ImageDrop({
  imageUrl,
  onFile,
  onRemove,
  busy,
  label = "Add a picture",
  className,
  children,
}: {
  imageUrl?: string | null;
  onFile: (file: File) => void;
  onRemove?: () => void;
  busy?: boolean;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { over, handlers } = usePictureDrop(onFile);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        {...handlers}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/40 transition-colors hover:border-primary/60",
          over && "border-primary bg-primary/10",
          imageUrl && "border-solid",
          className,
        )}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-center text-xs text-muted-foreground">
            <ImagePlusIcon className="size-5" />
            {label}
            <span className="text-[10px]">drop it here or click</span>
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner />
          </span>
        )}
        {children}
      </button>
      {imageUrl && (
        <div className="flex justify-center gap-3 text-xs text-muted-foreground">
          <button type="button" onClick={() => input.current?.click()} className="hover:underline">
            Change
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} className="hover:underline">
              Remove
            </button>
          )}
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
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
