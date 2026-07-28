// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure lookup over a static table)
// Writes:      nothing
// Errors:      none — unknown circuits fall back to a generic trophy, never throw
// Idempotent:  yes
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_TROPHY_ASSETS-000-v02
// [Intent] FEAT-TROPHY-002 — resolve a race to its trophy artwork and host-nation flag. Real F1
//          trophies are unique to each host city and change most years, so every circuit has its own
//          cup silhouette and accent ring; the podium place selects the metal. One drawing serves
//          both the 1em icon on Standings and the 64px portrait-sized tile on Teams.
// @FIX(v3.20.1): artwork is now generated in code as data URIs (lib/trophy-art) instead of being
//          served from app/public. This deployment does not serve Next.js static assets — verified
//          in production 2026-07-28: /logo.svg and /diagnostic.js 404 and have done since long
//          before this feature, while /robots.txt only answers because Cloudflare serves it. The
//          v3.20.0 release shipped 85 SVG files under public/ and every one 404'd, so the trophy
//          strip rendered as broken-image placeholders. These two functions are the seam: if static
//          serving is ever fixed they can go back to returning paths with no caller changes.
// [Inbound Trigger] Standings trophy strip, Teams trophy cabinet, Results podium badges.
// [Downstream Impact] Adding a circuit to RaceSchedule without adding a CIRCUITS row degrades to the
//          fallback cup (no crash) — a visual regression, never an outage, and the consistency
//          checker reports it via hasCircuitAsset.
//
// GR#15 note: this table is keyed by RaceSchedule.location (the circuit), NOT by race name, because
// two rounds can share a country and a name ("Spanish Grand Prix" / "Spanish Grand Prix II") while
// always differing by location. Nothing here hardcodes a race count.

import { trophyDataUri, flagDataUri, hasFlagSpec } from '@/lib/trophy-art';

export interface CircuitAsset {
  /** Stable identifier for this circuit's artwork, e.g. "spa". */
  slug: string;
  /** Flag spec key, e.g. "belgium". */
  country: string;
  /** Human-readable host nation, for alt text and tooltips. */
  countryName: string;
  /** Which of the five cup silhouettes this circuit uses. */
  shape: number;
}

// GUID: LIB_TROPHY_ASSETS-001-v02
// [Intent] Circuit (RaceSchedule.location) -> artwork identity. One row per round on the calendar.
//          Shapes are spread so consecutive rounds never share a silhouette, and the two Spanish
//          rounds differ in shape despite sharing a flag.
const CIRCUITS: Record<string, CircuitAsset> = {
  'Melbourne':          { slug: 'melbourne',   country: 'australia',   countryName: 'Australia',            shape: 0 },
  'Shanghai':           { slug: 'shanghai',    country: 'china',       countryName: 'China',                shape: 1 },
  'Suzuka':             { slug: 'suzuka',      country: 'japan',       countryName: 'Japan',                shape: 2 },
  'Miami':              { slug: 'miami',       country: 'usa',         countryName: 'United States',        shape: 3 },
  'Montreal':           { slug: 'montreal',    country: 'canada',      countryName: 'Canada',               shape: 4 },
  'Monaco':             { slug: 'monaco',      country: 'monaco',      countryName: 'Monaco',               shape: 0 },
  'Barcelona':          { slug: 'barcelona',   country: 'spain',       countryName: 'Spain',                shape: 1 },
  'Spielberg':          { slug: 'spielberg',   country: 'austria',     countryName: 'Austria',              shape: 2 },
  'Silverstone':        { slug: 'silverstone', country: 'uk',          countryName: 'United Kingdom',       shape: 3 },
  'Spa-Francorchamps':  { slug: 'spa',         country: 'belgium',     countryName: 'Belgium',              shape: 4 },
  'Budapest':           { slug: 'budapest',    country: 'hungary',     countryName: 'Hungary',              shape: 0 },
  'Zandvoort':          { slug: 'zandvoort',   country: 'netherlands', countryName: 'Netherlands',          shape: 1 },
  'Monza':              { slug: 'monza',       country: 'italy',       countryName: 'Italy',                shape: 2 },
  'Madrid':             { slug: 'madrid',      country: 'spain',       countryName: 'Spain',                shape: 3 },
  'Baku':               { slug: 'baku',        country: 'azerbaijan',  countryName: 'Azerbaijan',           shape: 4 },
  'Singapore':          { slug: 'singapore',   country: 'singapore',   countryName: 'Singapore',            shape: 0 },
  'Austin':             { slug: 'austin',      country: 'usa',         countryName: 'United States',        shape: 1 },
  'Mexico City':        { slug: 'mexico-city', country: 'mexico',      countryName: 'Mexico',               shape: 2 },
  'Sao Paulo':          { slug: 'sao-paulo',   country: 'brazil',      countryName: 'Brazil',               shape: 3 },
  'Las Vegas':          { slug: 'las-vegas',   country: 'usa',         countryName: 'United States',        shape: 4 },
  'Lusail':             { slug: 'lusail',      country: 'qatar',       countryName: 'Qatar',                shape: 0 },
  'Yas Marina':         { slug: 'yas-marina',  country: 'uae',         countryName: 'United Arab Emirates', shape: 1 },
};

// Used when a calendar entry has no artwork yet — a real cup stands in rather than a broken image.
const FALLBACK: CircuitAsset = { slug: 'unknown', country: 'uk', countryName: 'Unknown', shape: 0 };

// GUID: LIB_TROPHY_ASSETS-002-v02
// [Intent] Look up a circuit's artwork identity by RaceSchedule.location.
// [Inbound Trigger] Trophy rendering on Standings, Teams and Results.
// [Downstream Impact] Never throws — unknown locations degrade to FALLBACK.
export function getCircuitAsset(location: string | undefined | null): CircuitAsset {
  if (!location) return FALLBACK;
  return CIRCUITS[location] ?? FALLBACK;
}

// GUID: LIB_TROPHY_ASSETS-005-v02
// [Intent] Whether a circuit has its OWN artwork, as opposed to silently falling back. The
//          consistency checker needs this: getCircuitAsset never fails, so without an explicit test
//          a calendar change would quietly serve the fallback cup for a new circuit forever.
// [Inbound Trigger] checkTrophies in lib/consistency.ts.
// [Downstream Impact] Returning false raises a consistency warning naming the circuit.
export function hasCircuitAsset(location: string | undefined | null): boolean {
  return !!location && Object.prototype.hasOwnProperty.call(CIRCUITS, location);
}

// GUID: LIB_TROPHY_ASSETS-006-v02
// [Intent] Render every trophy and flag once, so the consistency checker can prove each circuit
//          actually produces artwork. Replaces the former URL sweep — with the drawings generated
//          in code there is no file to HEAD-request, but a circuit whose spec is broken or whose
//          flag key is missing is still a real failure worth catching.
// [Inbound Trigger] checkTrophyAssets.
// [Downstream Impact] Returns one row per circuit+place, plus the flag check per circuit.
export function renderAllTrophyArt(): { id: string; uri: string; flagOk: boolean }[] {
  const out: { id: string; uri: string; flagOk: boolean }[] = [];
  for (const [location, asset] of Object.entries(CIRCUITS)) {
    const flagOk = hasFlagSpec(asset.country);
    ([1, 2, 3] as const).forEach(place => {
      out.push({
        id: `${location} ${place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'}`,
        uri: getTrophyImage(location, place),
        flagOk,
      });
    });
  }
  return out;
}

// GUID: LIB_TROPHY_ASSETS-003-v02
// [Intent] The trophy image for a circuit and podium place, as an inline data URI.
// [Inbound Trigger] Trophy strip (1em) and trophy cabinet (64px) — same drawing at both sizes.
// [Downstream Impact] Fed straight to <img src>. Memoised inside lib/trophy-art.
export function getTrophyImage(location: string | undefined | null, place: 1 | 2 | 3): string {
  const asset = getCircuitAsset(location);
  const circuit = location ? String(location).split('-')[0] : 'Prix Six';
  return trophyDataUri({ shape: asset.shape, country: asset.country, circuit, place });
}

// GUID: LIB_TROPHY_ASSETS-004-v02
// [Intent] The host-nation flag for a circuit, as an inline data URI.
// [Inbound Trigger] The large trophy tile on the Teams page, beside the track name.
// [Downstream Impact] Simplified drawings, deliberately not emoji flags — emoji flags do not render
//          on Windows Chrome (they show as letter pairs), which is most of this league.
export function getFlagImage(location: string | undefined | null): string {
  return flagDataUri(getCircuitAsset(location).country);
}
