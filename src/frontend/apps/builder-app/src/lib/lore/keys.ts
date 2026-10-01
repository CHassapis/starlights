/**
 * Keys of compendium entries, in 5etools' own format: each part lower-cased and URL-encoded, joined by "_"
 * ("fireball_xphb", "tasha's%20hideous%20laughter_phb"). The data's renamed-entry redirects use the same format, so
 * old links keep working. Shared by the ingest script (run by Node directly) and the app: no path aliases, and
 * imports between these modules name their .ts files.
 */
export function keyPart(part: string): string {
  return encodeURIComponent(part.toLowerCase()).toLowerCase();
}

export function entryKey(name: string, source: string): string {
  return `${keyPart(name)}_${keyPart(source)}`;
}

/** The key from a route parameter, which the router hands over decoded. */
export function keyFromParam(param: string): string {
  return param.split("_").map(keyPart).join("_");
}
