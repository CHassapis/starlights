import { ElementDetails } from "@/components/element-details";

/**
 * The builder's info pane: everything about one element (see ElementDetails), or a hint when nothing is chosen.
 */
export function ElementPanel({ id, emptyHint }: { id: string | null; emptyHint?: string }) {
  return <ElementDetails id={id} emptyHint={emptyHint} />;
}
