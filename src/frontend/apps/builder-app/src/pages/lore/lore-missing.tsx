/** What the compendium shows before its data has been built on this server. */
export function LoreMissing() {
  return (
    <div className="mx-auto max-w-xl space-y-3 px-4 py-16 text-center">
      <h1 className="font-heading text-2xl tracking-wide">The Compendium of Lore is not set up yet</h1>
      <p className="text-muted-foreground">
        Its books are built on the server from the 5etools data. Whoever runs this server can build them with <code className="rounded bg-muted px-1">scripts/starlights-lore-ingest.sh</code>.
      </p>
    </div>
  );
}
