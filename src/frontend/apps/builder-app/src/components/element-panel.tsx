import DOMPurify from "dompurify";
import { useMemo } from "react";
import DescriptionProseSection from "@/components/description-section";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useCompendiumEntry } from "@/lib/api/compendium";

/**
 * Name, type, source and the (sanitised) Aurora description of one element — the builder's info pane.
 */
export function ElementPanel({ id, emptyHint }: { id: string | null; emptyHint?: string }) {
  const { data, isLoading } = useCompendiumEntry(id);
  // inline styles are tuned for Aurora's own viewer (negative margins etc.) and clash with the prose styles
  const html = useMemo(() => (data ? DOMPurify.sanitize(data.description, { FORBID_ATTR: ["style"] }) : ""), [data]);

  if (!id) return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  if (isLoading && !data) return <Spinner className="mx-auto my-6 size-5" />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-heading text-xl tracking-wide">{data.name}</h3>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge>{data.type}</Badge>
          {data.source && <Badge variant="outline">{data.source}</Badge>}
        </div>
      </div>
      {html ? (
        <DescriptionProseSection className="prose-sm [&_table]:block [&_table]:overflow-x-auto [&_td]:pr-3 [&_thead_td]:font-semibold">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </DescriptionProseSection>
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </div>
  );
}
