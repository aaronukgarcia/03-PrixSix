// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure string generation from a static spec)
// Writes:      nothing
// Errors:      none — unknown circuits fall back to a generic cup
// Idempotent:  yes (memoised; same input always yields the same data URI)
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_TROPHY_ART-000-v01
// [Intent] FEAT-TROPHY-002 — draw the per-circuit trophy and host-nation flag as inline SVG data
//          URIs. Real F1 trophies are unique to each host city and change most years, so each
//          circuit gets its own cup silhouette and accent ring; the podium place drives the metal.
//
//          WHY DATA URIs AND NOT FILES IN /public: this deployment does not serve Next.js static
//          assets. Verified in production on 2026-07-28 — /logo.svg and /diagnostic.js have been
//          404ing since long before this feature, while /robots.txt only answers because
//          Cloudflare serves it. The first cut of this feature shipped 85 SVG files under
//          app/public and every one of them 404'd, so the standings strip rendered as broken-image
//          placeholders. Generating the artwork in code removes the platform dependency entirely:
//          nothing to deploy, nothing to 404, and the whole spec is ~6KB of JS instead of 305KB of
//          files. If static serving is ever fixed, this can move back to files without touching
//          any caller — getTrophyImage/getFlagImage are the seam.
// [Inbound Trigger] lib/trophy-assets.ts, which every trophy renderer calls.
// [Downstream Impact] Output is fed to <img src>. Data URIs are permitted by the app's CSP
//          (img-src includes data:). SVG in an <img> cannot execute script, so inlining is safe.

export type PodiumPlace = 1 | 2 | 3;

interface FlagSpec {
  orientation: 'h' | 'v';
  colours: string[];
  weights?: number[];
  overlay?: string;
}

// GUID: LIB_TROPHY_ART-001-v01
// [Intent] Simplified host-nation flags. Deliberately NOT emoji flags — emoji flags do not render
//          on Windows Chrome (they degrade to letter pairs), which is what most of the league uses.
//          Recognisable rather than heraldically exact.
const FLAGS: Record<string, FlagSpec> = {
  australia:   { orientation: 'h', colours: ['#00008B'], overlay: 'union+stars' },
  china:       { orientation: 'h', colours: ['#DE2910'], overlay: 'cn-stars' },
  japan:       { orientation: 'h', colours: ['#FFFFFF'], overlay: 'jp-disc' },
  usa:         { orientation: 'h', colours: ['#B22234','#FFFFFF','#B22234','#FFFFFF','#B22234','#FFFFFF','#B22234'], overlay: 'us-canton' },
  canada:      { orientation: 'v', colours: ['#D80621','#FFFFFF','#D80621'], overlay: 'ca-leaf' },
  monaco:      { orientation: 'h', colours: ['#CE1126','#FFFFFF'] },
  spain:       { orientation: 'h', colours: ['#AA151B','#F1BF00','#AA151B'], weights: [1,2,1] },
  austria:     { orientation: 'h', colours: ['#ED2939','#FFFFFF','#ED2939'] },
  uk:          { orientation: 'h', colours: ['#012169'], overlay: 'union' },
  belgium:     { orientation: 'v', colours: ['#000000','#FAE042','#ED2939'] },
  hungary:     { orientation: 'h', colours: ['#CE2939','#FFFFFF','#477050'] },
  netherlands: { orientation: 'h', colours: ['#AE1C28','#FFFFFF','#21468B'] },
  italy:       { orientation: 'v', colours: ['#008C45','#F4F5F0','#CD212A'] },
  azerbaijan:  { orientation: 'h', colours: ['#00B5E2','#EF3340','#509E2F'], overlay: 'crescent' },
  singapore:   { orientation: 'h', colours: ['#ED2939','#FFFFFF'], overlay: 'crescent-sm' },
  mexico:      { orientation: 'v', colours: ['#006847','#FFFFFF','#CE1126'], overlay: 'mx-emblem' },
  brazil:      { orientation: 'h', colours: ['#009C3B'], overlay: 'br-diamond' },
  qatar:       { orientation: 'v', colours: ['#FFFFFF','#8A1538'], weights: [1,2] },
  uae:         { orientation: 'h', colours: ['#00732F','#FFFFFF','#000000'], overlay: 'uae-bar' },
};

const METAL: Record<PodiumPlace, { light: string; mid: string; dark: string; label: string }> = {
  1: { light: '#FFE9A3', mid: '#E8B923', dark: '#9A6F05', label: '1st' },
  2: { light: '#F2F4F6', mid: '#B9C0C7', dark: '#7A828A', label: '2nd' },
  3: { light: '#F0C9A0', mid: '#C1783C', dark: '#7E4715', label: '3rd' },
};

// GUID: LIB_TROPHY_ART-002-v01
// [Intent] Five cup silhouettes, assigned per circuit so no two neighbouring rounds look alike.
const SHAPES: string[] = [
  '<path d="M30 22 h40 v14 a20 20 0 0 1 -40 0 z"/>',
  '<path d="M34 18 h32 l-4 22 a12 12 0 0 1 -24 0 z"/>',
  '<path d="M32 20 h36 v10 a18 18 0 0 1 -36 0 z"/><circle cx="50" cy="30" r="15"/>',
  '<path d="M30 18 h40 l-8 24 h-24 z"/>',
  '<path d="M31 19 h38 v9 a19 19 0 0 1 -38 0 z"/><path d="M38 33 h24 v6 a12 12 0 0 1 -24 0 z"/>',
];

function flagBody(spec: FlagSpec): string {
  const W = 60, H = 40;
  const parts: string[] = [];
  const weights = spec.weights ?? spec.colours.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let offset = 0;
  spec.colours.forEach((c, i) => {
    const size = ((spec.orientation === 'h' ? H : W) * weights[i]) / total;
    parts.push(spec.orientation === 'h'
      ? `<rect x="0" y="${offset.toFixed(2)}" width="${W}" height="${size.toFixed(2)}" fill="${c}"/>`
      : `<rect x="${offset.toFixed(2)}" y="0" width="${size.toFixed(2)}" height="${H}" fill="${c}"/>`);
    offset += size;
  });

  const ov = spec.overlay;
  if (ov === 'jp-disc') parts.push('<circle cx="30" cy="20" r="11" fill="#BC002D"/>');
  if (ov === 'cn-stars') parts.push('<path d="M12 8 l2.2 6.6 h6.9 l-5.6 4.1 2.2 6.6 -5.7-4.1 -5.6 4.1 2.1-6.6 -5.6-4.1 h6.9 z" fill="#FFDE00"/>');
  if (ov === 'union' || ov === 'union+stars') {
    const s = ov === 'union+stars' ? 'scale(0.5 0.5)' : '';
    parts.push(`<g transform="${s}">`
      + '<path d="M0 0 L60 40 M60 0 L0 40" stroke="#FFFFFF" stroke-width="8"/>'
      + '<path d="M0 0 L60 40 M60 0 L0 40" stroke="#C8102E" stroke-width="4"/>'
      + '<path d="M30 0 V40 M0 20 H60" stroke="#FFFFFF" stroke-width="12"/>'
      + '<path d="M30 0 V40 M0 20 H60" stroke="#C8102E" stroke-width="7"/>'
      + '</g>');
    if (ov === 'union+stars') {
      parts.push('<circle cx="15" cy="31" r="4" fill="#FFFFFF"/>');
      [[44,9],[50,20],[44,31],[38,20],[52,29]].forEach(([x, y]) => parts.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="#FFFFFF"/>`));
    }
  }
  if (ov === 'us-canton') {
    parts.push('<rect x="0" y="0" width="26" height="21" fill="#3C3B6E"/>');
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) parts.push(`<circle cx="${3 + c * 5}" cy="${3.5 + r * 5}" r="1.3" fill="#FFFFFF"/>`);
  }
  if (ov === 'ca-leaf') parts.push('<path d="M30 9 l3 7 5-2 -2 6 6 1 -5 4 2 6 -7-3 -2 5 -2-5 -7 3 2-6 -5-4 6-1 -2-6 5 2 z" fill="#D80621"/>');
  if (ov === 'crescent') parts.push('<circle cx="30" cy="20" r="7" fill="#FFFFFF"/><circle cx="33" cy="20" r="6" fill="#EF3340"/>');
  if (ov === 'crescent-sm') parts.push('<circle cx="13" cy="10" r="6" fill="#FFFFFF"/><circle cx="16" cy="10" r="5" fill="#ED2939"/>');
  if (ov === 'mx-emblem') parts.push('<circle cx="30" cy="20" r="6" fill="#8B5A2B" opacity="0.85"/>');
  if (ov === 'br-diamond') parts.push('<path d="M30 6 L54 20 L30 34 L6 20 z" fill="#FFDF00"/><circle cx="30" cy="20" r="8" fill="#002776"/>');
  if (ov === 'uae-bar') parts.push('<rect x="0" y="0" width="16" height="40" fill="#FF0000"/>');

  return parts.join('');
}

// Percent-encoding rather than base64: smaller for SVG, and readable in devtools.
function toDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const flagCache = new Map<string, string>();
const trophyCache = new Map<string, string>();

// GUID: LIB_TROPHY_ART-003-v01
// [Intent] Host-nation flag as a data URI. Memoised — a standings page can ask for the same flag
//          dozens of times in one render.
export function flagDataUri(country: string): string {
  const cached = flagCache.get(country);
  if (cached) return cached;
  const spec = FLAGS[country] ?? FLAGS.uk;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60" height="40">${flagBody(spec)}<rect x="0" y="0" width="60" height="40" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/></svg>`;
  const uri = toDataUri(svg);
  flagCache.set(country, uri);
  return uri;
}

// GUID: LIB_TROPHY_ART-004-v01
// [Intent] The trophy itself: circuit-specific silhouette, host-nation accent ring, engraved circuit
//          name, and a metal gradient chosen by podium place. One drawing serves both the 1em icon
//          on Standings and the 64px tile on Teams.
// [Inbound Trigger] getTrophyImage in lib/trophy-assets.ts.
// [Downstream Impact] Memoised per circuit+place; at most 3 entries per circuit.
export function trophyDataUri(opts: { shape: number; country: string; circuit: string; place: PodiumPlace }): string {
  const key = `${opts.circuit}-${opts.place}`;
  const cached = trophyCache.get(key);
  if (cached) return cached;

  const m = METAL[opts.place];
  const flag = FLAGS[opts.country] ?? FLAGS.uk;
  const accent = flag.colours.find(c => c.toUpperCase() !== '#FFFFFF') ?? '#444444';
  const bowl = SHAPES[opts.shape % SHAPES.length];
  const gid = `t${opts.shape}${opts.place}${opts.circuit.replace(/[^a-zA-Z]/g, '')}`;
  const label = opts.circuit.toUpperCase();
  const fontSize = label.length > 10 ? 7 : label.length > 8 ? 8 : 9;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">`
    + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="${m.light}"/><stop offset="45%" stop-color="${m.mid}"/><stop offset="100%" stop-color="${m.dark}"/>`
    + `</linearGradient></defs>`
    + `<circle cx="50" cy="50" r="47" fill="none" stroke="${accent}" stroke-width="4" opacity="0.55"/>`
    + `<g fill="url(#${gid})" stroke="${m.dark}" stroke-width="1.5" stroke-linejoin="round">`
    + bowl
    + `<path d="M30 24 q-10 2 -8 10 q2 6 8 5" fill="none" stroke="${m.dark}" stroke-width="3"/>`
    + `<path d="M70 24 q10 2 8 10 q-2 6 -8 5" fill="none" stroke="${m.dark}" stroke-width="3"/>`
    + `<rect x="46" y="52" width="8" height="14"/><rect x="36" y="66" width="28" height="6" rx="2"/><rect x="30" y="72" width="40" height="12" rx="3"/>`
    + `</g>`
    + `<text x="50" y="81" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="${fontSize}" font-weight="bold" fill="${m.dark}">${label}</text>`
    + `<text x="50" y="96" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" font-weight="bold" fill="${m.mid}">${m.label}</text>`
    + `</svg>`;

  const uri = toDataUri(svg);
  trophyCache.set(key, uri);
  return uri;
}

// GUID: LIB_TROPHY_ART-005-v01
// [Intent] Whether a country has a flag spec — used by the consistency checker so a new host nation
//          cannot silently fall back to another country's flag.
export function hasFlagSpec(country: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLAGS, country);
}
