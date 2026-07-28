// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure lookup over a static table)
// Writes:      nothing
// Errors:      none — unknown circuits fall back to a generic trophy, never throw
// Idempotent:  yes
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_TROPHY_ASSETS-000-v01
// [Intent] FEAT-TROPHY-002 — resolve a race to its self-hosted trophy artwork and host-nation flag.
//          Real F1 trophies are unique to each host city and change most years, so every circuit has
//          its own cup silhouette and accent ring; the podium place selects the metal. Assets are
//          SVG so ONE file serves both the 1em icon on Standings and the 64px portrait-sized tile on
//          Teams — no second asset, no rasteriser dependency.
// [Inbound Trigger] Standings trophy strip, Teams trophy cabinet, Results podium badges.
// [Downstream Impact] Files live in app/public/trophies and app/public/flags. Adding a circuit to
//          RaceSchedule without adding a CIRCUITS row degrades to the generic trophy (no crash), so
//          a calendar change is a visual regression, never an outage.
//
// GR#15 note: this table is keyed by RaceSchedule.location (the circuit), NOT by race name, because
// two rounds can share a country and a name ("Spanish Grand Prix" / "Spanish Grand Prix II") while
// always differing by location. Nothing here hardcodes a race count.

export interface CircuitAsset {
  /** Asset filename stem, e.g. "spa" -> /trophies/spa-1.svg */
  slug: string;
  /** Flag filename stem, e.g. "belgium" -> /flags/belgium.svg */
  country: string;
  /** Human-readable host nation, for alt text and tooltips. */
  countryName: string;
}

// GUID: LIB_TROPHY_ASSETS-001-v01
// [Intent] Circuit (RaceSchedule.location) -> artwork identity. One row per round on the calendar.
// [Inbound Trigger] getCircuitAsset.
// [Downstream Impact] The slug must match a generated file stem in app/public/trophies.
const CIRCUITS: Record<string, CircuitAsset> = {
  'Melbourne':          { slug: 'melbourne',   country: 'australia',   countryName: 'Australia' },
  'Shanghai':           { slug: 'shanghai',    country: 'china',       countryName: 'China' },
  'Suzuka':             { slug: 'suzuka',      country: 'japan',       countryName: 'Japan' },
  'Miami':              { slug: 'miami',       country: 'usa',         countryName: 'United States' },
  'Montreal':           { slug: 'montreal',    country: 'canada',      countryName: 'Canada' },
  'Monaco':             { slug: 'monaco',      country: 'monaco',      countryName: 'Monaco' },
  'Barcelona':          { slug: 'barcelona',   country: 'spain',       countryName: 'Spain' },
  'Spielberg':          { slug: 'spielberg',   country: 'austria',     countryName: 'Austria' },
  'Silverstone':        { slug: 'silverstone', country: 'uk',          countryName: 'United Kingdom' },
  'Spa-Francorchamps':  { slug: 'spa',         country: 'belgium',     countryName: 'Belgium' },
  'Budapest':           { slug: 'budapest',    country: 'hungary',     countryName: 'Hungary' },
  'Zandvoort':          { slug: 'zandvoort',   country: 'netherlands', countryName: 'Netherlands' },
  'Monza':              { slug: 'monza',       country: 'italy',       countryName: 'Italy' },
  'Madrid':             { slug: 'madrid',      country: 'spain',       countryName: 'Spain' },
  'Baku':               { slug: 'baku',        country: 'azerbaijan',  countryName: 'Azerbaijan' },
  'Singapore':          { slug: 'singapore',   country: 'singapore',   countryName: 'Singapore' },
  'Austin':             { slug: 'austin',      country: 'usa',         countryName: 'United States' },
  'Mexico City':        { slug: 'mexico-city', country: 'mexico',      countryName: 'Mexico' },
  'Sao Paulo':          { slug: 'sao-paulo',   country: 'brazil',      countryName: 'Brazil' },
  'Las Vegas':          { slug: 'las-vegas',   country: 'usa',         countryName: 'United States' },
  'Lusail':             { slug: 'lusail',      country: 'qatar',       countryName: 'Qatar' },
  'Yas Marina':         { slug: 'yas-marina',  country: 'uae',         countryName: 'United Arab Emirates' },
};

// Used when a calendar entry has no artwork yet — Melbourne's cup stands in rather than a broken
// image. Deliberately a real circuit so the tile still looks intentional.
const FALLBACK: CircuitAsset = { slug: 'melbourne', country: 'australia', countryName: 'Australia' };

// GUID: LIB_TROPHY_ASSETS-002-v01
// [Intent] Look up a circuit's artwork identity by RaceSchedule.location.
// [Inbound Trigger] Trophy rendering on Standings, Teams and Results.
// [Downstream Impact] Never throws — unknown locations degrade to FALLBACK.
export function getCircuitAsset(location: string | undefined | null): CircuitAsset {
  if (!location) return FALLBACK;
  return CIRCUITS[location] ?? FALLBACK;
}

// GUID: LIB_TROPHY_ASSETS-005-v01
// [Intent] Whether a circuit has its OWN artwork, as opposed to silently falling back. The
//          consistency checker needs this: getCircuitAsset never fails, so without an explicit test
//          a calendar change would quietly serve Melbourne's cup for a brand-new circuit forever.
// [Inbound Trigger] checkTrophies in lib/consistency.ts.
// [Downstream Impact] Returning false raises a consistency warning naming the circuit.
export function hasCircuitAsset(location: string | undefined | null): boolean {
  return !!location && Object.prototype.hasOwnProperty.call(CIRCUITS, location);
}

// GUID: LIB_TROPHY_ASSETS-006-v01
// [Intent] Every artwork URL the app can serve, for an existence sweep by the consistency checker.
// [Inbound Trigger] checkTrophyAssets.
// [Downstream Impact] Enumerates circuits × places plus one flag per distinct country.
export function allTrophyAssetUrls(): string[] {
  const urls: string[] = [];
  const countries = new Set<string>();
  for (const asset of Object.values(CIRCUITS)) {
    urls.push(`/trophies/${asset.slug}-1.svg`, `/trophies/${asset.slug}-2.svg`, `/trophies/${asset.slug}-3.svg`);
    countries.add(asset.country);
  }
  countries.forEach(c => urls.push(`/flags/${c}.svg`));
  return [...new Set(urls)];
}

// GUID: LIB_TROPHY_ASSETS-003-v01
// [Intent] Public URL of the trophy artwork for a circuit and podium place.
// [Inbound Trigger] Trophy strip (1em) and trophy cabinet (64px) — same file at both sizes.
// [Downstream Impact] Resolves to a static file under /public; a missing file renders as a broken
//          image, which is why getCircuitAsset never returns an unknown slug.
export function getTrophyImage(location: string | undefined | null, place: 1 | 2 | 3): string {
  return `/trophies/${getCircuitAsset(location).slug}-${place}.svg`;
}

// GUID: LIB_TROPHY_ASSETS-004-v01
// [Intent] Public URL of the host-nation flag for a circuit.
// [Inbound Trigger] The large trophy tile on the Teams page, beside the track name.
// [Downstream Impact] Simplified self-hosted drawings, deliberately not emoji flags — emoji flags do
//          not render on Windows Chrome (they show as letter pairs), which is most of this league.
export function getFlagImage(location: string | undefined | null): string {
  return `/flags/${getCircuitAsset(location).country}.svg`;
}
