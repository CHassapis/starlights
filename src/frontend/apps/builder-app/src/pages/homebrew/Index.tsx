import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConicalIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import { isAdmin } from "@/lib/player";

interface HomebrewFile {
  file: string;
  elements: { name: string; type: string; source: string | null }[];
}

/**
 * The group's own content: Aurora element files (.xml). Everyone can see what is there; adding or removing files
 * needs the master admin password (key button in the header).
 */
export function HomebrewPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const admin = isAdmin();
  const { data, isLoading } = useQuery({ queryKey: ["homebrew"], queryFn: () => apiClient.get<{ files: HomebrewFile[] }>("/api/elements/homebrew") });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["homebrew"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["compendium"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["sources"] }).catch(() => {});
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await apiClient.post("/api/elements/homebrew", { fileName: file.name, content: await file.text() });
      }
    },
    onSuccess: (_, files) => toast.success(`${files.length} homebrew ${files.length === 1 ? "file" : "files"} added`),
    onError: (e) => toast.error("Could not add the homebrew", { description: e.message }),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (file: string) => apiClient.delete(`/api/elements/homebrew/${encodeURIComponent(file)}`),
    onError: (e) => toast.error("Could not remove it", { description: e.message }),
    onSettled: refresh,
  });

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl tracking-wide">Homebrew</h1>
          <p className="text-muted-foreground">
            Your group's own races, classes, subclasses, backgrounds and feats, as Aurora element files. They appear in the builder under the
            Homebrew sources.
          </p>
        </div>
        {admin ? (
          <>
            <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner /> : <UploadIcon />} Add homebrew (.xml)
            </Button>
            <input
              ref={input}
              type="file"
              accept=".xml,text/xml"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) upload.mutate(files);
              }}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Unlock admin (key button at the top) to add homebrew.</p>
        )}
      </header>

      {isLoading && <Spinner className="mx-auto my-8 size-6" />}
      {data?.files.length === 0 && <p className="text-muted-foreground">No homebrew yet.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.files.map((f) => (
          <section key={f.file} className="rounded-lg border bg-background/60 p-4">
            <div className="flex items-start gap-2">
              <FlaskConicalIcon className="mt-0.5 size-4 text-muted-foreground" />
              <h2 className="min-w-0 flex-1 truncate font-medium">{f.file}</h2>
              {admin && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${f.file}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`Remove ${f.file} and its ${f.elements.length} elements? Characters using them lose those picks.`)) remove.mutate(f.file);
                  }}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {f.elements
                .filter((e) => e.source !== "Internal")
                .map((e) => (
                  <li key={e.type + e.name} className="flex items-center gap-2">
                    <Link to={`/compendium?q=${encodeURIComponent(e.name)}`} className="truncate hover:underline">
                      {e.name}
                    </Link>
                    <Badge variant="outline" className="ms-auto shrink-0">
                      {e.type}
                    </Badge>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
