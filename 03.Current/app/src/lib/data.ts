// GUID: LIB_DATA-000-v06
// @SECURITY_FIX (GEMINI-AUDIT-051): imageId removed from public Driver interface and moved to
//   internal InternalDriver type. Public F1Drivers export strips imageId to prevent asset enumeration.
//   getDriverImage() is the only sanctioned API for resolving driver images.
// @SECURITY_ACCEPTED_RISK (GEMINI-AUDIT-052): RaceSchedule timing is client-side UX data only.
//   Deadline enforcement is performed server-side via Firestore (race-schedule-server.ts + submit-prediction API).
//   Clients knowing qualifying times in advance provides no meaningful bypass capability because
//   the server independently validates every submission against Firestore-stored deadlines.
// @SECURITY_NOTE (GEMINI-AUDIT-123): The RaceSchedule and F1Drivers arrays are hardcoded
// client-side. If the 2026 season calendar changes mid-season (postponements, cancellations,
// new slots), this static data will desync from the server-side Firestore source.
// Impact: incorrect race countdowns, submission deadline errors, wrong raceId lookups.
// Mitigation: Admin must update this file and redeploy when FIA calendar changes.
// Accepted risk for the 2026 season -- a Firestore-driven calendar is a future enhancement.
// [Intent] Provides standing data for F1 drivers and race schedule used throughout the app.
//          Acts as the single source of truth for driver identities, team assignments, numbers,
//          image mappings, and the 2026 race calendar with qualifying/sprint/race times.
// [Inbound Trigger] Imported by components and pages that need driver info (predictions, scoring,
//                   submissions, standings) or race schedule data (deadline banners, next race logic).
// [Downstream Impact] Any change to driver IDs, names, or schedule times affects predictions,
//                     scoring, submissions, standings, and deadline calculations across the entire app.

import { PlaceHolderImages } from './placeholder-images';

// GUID: LIB_DATA-001-v04
// @SECURITY_FIX (GEMINI-AUDIT-051): Removed imageId from public Driver interface.
//   imageId now internal-only to prevent enumeration of CDN paths/assets. Components
//   MUST use getDriverImage() function to retrieve driver images - direct access blocked.
// [Intent] Define the shape of a Driver object used across the application (public fields only).
//          imageId is intentionally excluded to prevent potential asset enumeration attacks.
// [Inbound Trigger] Used by F1Drivers array and any component consuming driver data.
// [Downstream Impact] Components can no longer access driver.imageId directly. Use getDriverImage(driverId) instead.
export interface Driver {
  id: string;
  name: string;
  number: number;
  team: string;
}

// GUID: LIB_DATA-001A-v01
// [Intent] Internal driver type that includes imageId mapping. Used only within this module
//          for the F1Drivers array and getDriverImage() function. NOT exported.
// [Security] imageId must remain internal to prevent enumeration of placeholder image IDs.
interface InternalDriver extends Driver {
  imageId: string;
}

// GUID: LIB_DATA-002-v04
// @SECURITY_FIX (GEMINI-AUDIT-051): Changed to InternalDriver[] to maintain imageId internally.
//   While exported as Driver[] publicly (without imageId), internally uses InternalDriver to
//   preserve image mappings. getDriverImage() is the only sanctioned way to access driver images.
// [Intent] Master list of all F1 drivers for the 2026 season with their team assignments,
//          car numbers, and internal image IDs. This is the single source of truth for driver standing data.
// [Inbound Trigger] Referenced by getDriverImage, getDriverName, getDriverCode, formatDriverPredictions,
//                   and any component displaying driver information.
// [Downstream Impact] Adding, removing, or renaming drivers here propagates to all predictions,
//                     scoring, submissions, and UI displays. The Consistency Checker validates
//                     driver reference integrity against this list.
// [Security] imageId field is internal-only. External access via getDriverImage() prevents enumeration.
const InternalF1Drivers: InternalDriver[] = [
  // Red Bull Racing
  { id: 'verstappen', name: 'Verstappen', number: 3, team: 'Red Bull Racing', imageId: 'max-verstappen' },
  { id: 'hadjar', name: 'Hadjar', number: 6, team: 'Red Bull Racing', imageId: 'isack-hadjar' },
  // Ferrari
  { id: 'leclerc', name: 'Leclerc', number: 16, team: 'Ferrari', imageId: 'charles-leclerc' },
  { id: 'hamilton', name: 'Hamilton', number: 44, team: 'Ferrari', imageId: 'lewis-hamilton' },
  // McLaren
  { id: 'norris', name: 'Norris', number: 1, team: 'McLaren', imageId: 'lando-norris' },
  { id: 'piastri', name: 'Piastri', number: 81, team: 'McLaren', imageId: 'oscar-piastri' },
  // Mercedes
  { id: 'russell', name: 'Russell', number: 63, team: 'Mercedes', imageId: 'george-russell' },
  { id: 'antonelli', name: 'Antonelli', number: 12, team: 'Mercedes', imageId: 'kimi-antonelli' },
  // Aston Martin
  { id: 'alonso', name: 'Alonso', number: 14, team: 'Aston Martin', imageId: 'fernando-alonso' },
  { id: 'stroll', name: 'Stroll', number: 18, team: 'Aston Martin', imageId: 'lance-stroll' },
  // Alpine
  { id: 'gasly', name: 'Gasly', number: 10, team: 'Alpine', imageId: 'pierre-gasly' },
  { id: 'colapinto', name: 'Colapinto', number: 43, team: 'Alpine', imageId: 'franco-colapinto' },
  // Williams
  { id: 'albon', name: 'Albon', number: 23, team: 'Williams', imageId: 'alexander-albon' },
  { id: 'sainz', name: 'Sainz', number: 55, team: 'Williams', imageId: 'carlos-sainz' },
  // Racing Bulls
  { id: 'lawson', name: 'Lawson', number: 30, team: 'Racing Bulls', imageId: 'liam-lawson' },
  { id: 'lindblad', name: 'Lindblad', number: 41, team: 'Racing Bulls', imageId: 'arvid-lindblad' },
  // Audi (formerly Sauber)
  { id: 'hulkenberg', name: 'Hulkenberg', number: 27, team: 'Audi', imageId: 'nico-hulkenberg' },
  { id: 'bortoleto', name: 'Bortoleto', number: 5, team: 'Audi', imageId: 'gabriel-bortoleto' },
  // Haas F1 Team
  { id: 'ocon', name: 'Ocon', number: 31, team: 'Haas F1 Team', imageId: 'esteban-ocon' },
  { id: 'bearman', name: 'Bearman', number: 87, team: 'Haas F1 Team', imageId: 'oliver-bearman' },
  // Cadillac F1 Team
  { id: 'perez', name: 'Perez', number: 11, team: 'Cadillac F1 Team', imageId: 'sergio-perez' },
  { id: 'bottas', name: 'Bottas', number: 77, team: 'Cadillac F1 Team', imageId: 'valtteri-bottas' },
];

// GUID: LIB_DATA-002A-v01
// @SECURITY_FIX (GEMINI-AUDIT-051): Public F1Drivers export without imageId field.
//   Strips internal imageId to prevent enumeration of asset paths. Components can access
//   id, name, number, team but CANNOT access imageId directly. Use getDriverImage() instead.
// [Intent] Publicly-exported driver array without sensitive imageId field.
// [Security] Prevents components from enumerating internal CDN paths or placeholder image IDs.
export const F1Drivers: Driver[] = InternalF1Drivers.map(({ imageId, ...driver }) => driver);

// GUID: LIB_DATA-003-v04
// @SECURITY_FIX (GEMINI-AUDIT-051): Changed to use InternalF1Drivers instead of F1Drivers.
//   This is the ONLY sanctioned way to access driver images. Direct imageId access blocked.
// [Intent] Resolve a driver ID to their profile image URL via the placeholder images lookup.
//          Falls back to a generic placeholder if the driver or image is not found.
// [Inbound Trigger] Called by UI components that render driver avatars/photos (e.g., prediction cards, standings).
// [Downstream Impact] If PlaceHolderImages data changes or driver imageId mappings change,
//                     displayed driver images will change across the app.
// [Security] Abstracts imageId lookup to prevent enumeration attacks.
export const getDriverImage = (driverId: string) => {
    const driver = InternalF1Drivers.find(d => d.id === driverId);
    const image = PlaceHolderImages.find(p => p.id === driver?.imageId);
    return image?.imageUrl || 'https://picsum.photos/seed/placeholder/100/100';
}

// GUID: LIB_DATA-004-v04
// @SECURITY_FIX (GEMINI-AUDIT-051): Changed to use InternalF1Drivers for consistency.
//   Uses internal source data to avoid potential issues with stripped public array.
// [Intent] Resolve a driver ID (lowercase) to their display name (proper case).
//          Falls back to the raw ID if the driver is not found in the master list.
// [Inbound Trigger] Called by formatDriverPredictions and any UI displaying driver names from stored IDs.
// [Downstream Impact] Submissions page, scoring page, standings, and audit pages all depend on this
//                     for consistent driver name rendering.
/**
 * Get driver display name from driver ID.
 * Returns proper case name (e.g., "Hamilton") from lowercase ID (e.g., "hamilton").
 * Falls back to the ID if driver not found (shouldn't happen with valid data).
 */
export const getDriverName = (driverId: string): string => {
    if (!driverId) return 'N/A';
    const driver = InternalF1Drivers.find(d => d.id === driverId.toLowerCase());
    return driver?.name || driverId;
}

// GUID: LIB_DATA-005-v04
// @SECURITY_FIX (GEMINI-AUDIT-051): Changed to use InternalF1Drivers for consistency.
//   Uses internal source data to avoid potential issues with stripped public array.
// [Intent] Derive a 3-letter uppercase code from a driver ID (e.g., "hamilton" -> "HAM").
//          Uses the first 3 letters of the driver's name, or truncates the raw ID as fallback.
// [Inbound Trigger] Called by compact UI displays (e.g., scoring grids, leaderboard columns) that
//                   need abbreviated driver identifiers.
// [Downstream Impact] Changes to driver names affect the derived codes shown in compact views.
/**
 * Get driver 3-letter code from driver ID.
 * Returns uppercase code (e.g., "HAM") from lowercase ID (e.g., "hamilton").
 */
export const getDriverCode = (driverId: string): string => {
    if (!driverId) return 'N/A';
    const driver = InternalF1Drivers.find(d => d.id === driverId.toLowerCase());
    if (!driver) return driverId.substring(0, 3).toUpperCase();
    // Use first 3 letters of name as code
    return driver.name.substring(0, 3).toUpperCase();
}

// GUID: LIB_DATA-006-v03
// [Intent] Convert an array of driver IDs into a comma-separated string of display names.
//          Provides consistent formatting for prediction displays across the app.
// [Inbound Trigger] Called by Submissions and Audit pages to render stored prediction arrays as readable text.
// [Downstream Impact] If getDriverName behaviour changes, all formatted prediction displays change too.
/**
 * Format an array of driver IDs to display names.
 * Used by Submissions and Audit pages to show predictions consistently.
 */
export const formatDriverPredictions = (predictions: string[] | undefined): string => {
    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
        return 'N/A';
    }
    return predictions.map(id => getDriverName(id)).join(', ');
}

// GUID: LIB_DATA-007-v04
// [Intent] Define the shape of a Race object including timing, location, sprint flag, and results.
// [Inbound Trigger] Used by RaceSchedule array and any component consuming race calendar data.
// [Downstream Impact] Changing this interface requires updating all components that destructure Race objects.
// @CHANGE(v04): Added trackTimezone (IANA string) for admin pit-lane panel dual-timezone countdown display.
export interface Race {
  name: string;
  qualifyingTime: string; // UTC ISO string - when predictions auto-lock
  sprintTime?: string; // UTC ISO string - sprint race time (only for sprint weekends)
  raceTime: string; // UTC ISO string - main GP time
  location: string;
  hasSprint: boolean;
  results: (string | null)[];
  trackTimezone: string; // IANA timezone identifier e.g. "Australia/Melbourne"
}

// GUID: LIB_DATA-008-v05
// @SECURITY_ACCEPTED_RISK (GEMINI-AUDIT-052): Race timing values in this array are shipped in the
//   client bundle and are intentionally public. This is ACCEPTED RISK because:
//   1. Server-side enforcement: /api/submit-prediction uses getRaceByName() from race-schedule-server.ts
//      which reads qualifying deadlines exclusively from Firestore (admin-only writable collection).
//      The server independently validates every submission regardless of what the client knows.
//   2. Clients knowing race dates in advance provides no meaningful bypass — the actual gate is the
//      server clock comparison against the Firestore-stored qualifyingTime.
//   3. This data is publicly available (official F1 calendar) — obscuring it provides no security benefit.
//   ACTION REQUIRED for future hardening: When admin UI for schedule management is built, consider
//   fetching these times via an authenticated endpoint so client bundle reflects only confirmed times.
// @BOW_RISK (Cy4hqh5EXe53Ww2LkqLR): Hardcoded Client-Side Season Calendar — Desync Risk.
//   A Firestore-backed race_schedule collection exists and is the authoritative server-side source.
//   However, multiple UI components (deadline banners, prediction editor, standings) still import
//   this static array directly. If the admin updates the Firestore calendar (e.g., to adjust qualifying
//   times for wet-weather postponements), this static array will be stale until a code deployment occurs.
//   KNOWN TECHNICAL DEBT: Refactor affected components to fetch from /api/race-schedule (server-side
//   source) instead of importing this constant. Until then, any calendar change requires BOTH a
//   Firestore update AND a code deployment to keep client UX in sync with the server deadline gate.
// [Intent] Master race calendar for the 2026 F1 season (24 races). Defines qualifying deadlines
//          (which lock predictions), sprint times, race times, and sprint flags.
//          This is the single source of truth for race schedule standing data (CLIENT-SIDE UX ONLY).
//          Server-side enforcement uses Firestore via race-schedule-server.ts (see GEMINI-AUDIT-052).
// [Inbound Trigger] Referenced by findNextRace, deadline banners, prediction lock logic,
//                   scoring pages, and the submissions view.
// [Downstream Impact] Changes to qualifying times affect when predictions lock.
//                     Changes to race names affect how races display across the app.
//                     The Consistency Checker validates track reference integrity against this list.
//                     Desync with Firestore race_schedule collection is a known risk (BOW: Cy4hqh5EXe53Ww2LkqLR).
export const RaceSchedule: Race[] = [
    // 2026 Official F1 Calendar (22 races — Bahrain & Saudi Arabia cancelled, no replacements)
    { name: "Australian Grand Prix",   location: "Melbourne",        raceTime: "2026-03-08T04:00:00Z", qualifyingTime: "2026-03-07T05:00:00Z", hasSprint: false, results: [], trackTimezone: "Australia/Melbourne" },
    { name: "Chinese Grand Prix",      location: "Shanghai",         raceTime: "2026-03-15T07:00:00Z", qualifyingTime: "2026-03-13T07:00:00Z", sprintTime: "2026-03-14T03:00:00Z", hasSprint: true,  results: [], trackTimezone: "Asia/Shanghai" },
    { name: "Japanese Grand Prix",     location: "Suzuka",           raceTime: "2026-03-29T06:00:00Z", qualifyingTime: "2026-03-28T07:00:00Z", hasSprint: false, results: [], trackTimezone: "Asia/Tokyo" },
    { name: "Miami Grand Prix",        location: "Miami",            raceTime: "2026-05-03T20:00:00Z", qualifyingTime: "2026-05-01T21:00:00Z", sprintTime: "2026-05-02T20:00:00Z", hasSprint: true,  results: [], trackTimezone: "America/New_York" },
    { name: "Canadian Grand Prix",     location: "Montreal",         raceTime: "2026-05-24T18:00:00Z", qualifyingTime: "2026-05-22T20:00:00Z", sprintTime: "2026-05-23T18:00:00Z", hasSprint: true,  results: [], trackTimezone: "America/Toronto" },
    { name: "Monaco Grand Prix",       location: "Monaco",           raceTime: "2026-06-07T13:00:00Z", qualifyingTime: "2026-06-06T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Monaco" },
    { name: "Spanish Grand Prix",      location: "Barcelona",        raceTime: "2026-06-14T13:00:00Z", qualifyingTime: "2026-06-13T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Madrid" },
    { name: "Austrian Grand Prix",     location: "Spielberg",        raceTime: "2026-06-28T13:00:00Z", qualifyingTime: "2026-06-27T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Vienna" },
    { name: "British Grand Prix",      location: "Silverstone",      raceTime: "2026-07-05T14:00:00Z", qualifyingTime: "2026-07-03T15:00:00Z", sprintTime: "2026-07-04T14:00:00Z", hasSprint: true,  results: [], trackTimezone: "Europe/London" },
    { name: "Belgian Grand Prix",      location: "Spa-Francorchamps",raceTime: "2026-07-19T13:00:00Z", qualifyingTime: "2026-07-18T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Brussels" },
    { name: "Hungarian Grand Prix",    location: "Budapest",         raceTime: "2026-07-26T13:00:00Z", qualifyingTime: "2026-07-25T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Budapest" },
    { name: "Dutch Grand Prix",        location: "Zandvoort",        raceTime: "2026-08-23T13:00:00Z", qualifyingTime: "2026-08-21T14:00:00Z", sprintTime: "2026-08-22T13:00:00Z", hasSprint: true,  results: [], trackTimezone: "Europe/Amsterdam" },
    { name: "Italian Grand Prix",      location: "Monza",            raceTime: "2026-09-06T13:00:00Z", qualifyingTime: "2026-09-05T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Rome" },
    { name: "Spanish Grand Prix II",   location: "Madrid",           raceTime: "2026-09-13T13:00:00Z", qualifyingTime: "2026-09-12T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Europe/Madrid" },
    { name: "Azerbaijan Grand Prix",   location: "Baku",             raceTime: "2026-09-26T11:00:00Z", qualifyingTime: "2026-09-25T12:00:00Z", hasSprint: false, results: [], trackTimezone: "Asia/Baku" },
    { name: "Singapore Grand Prix",    location: "Singapore",        raceTime: "2026-10-11T12:00:00Z", qualifyingTime: "2026-10-09T13:00:00Z", sprintTime: "2026-10-10T12:00:00Z", hasSprint: true,  results: [], trackTimezone: "Asia/Singapore" },
    { name: "United States Grand Prix",location: "Austin",           raceTime: "2026-10-25T19:00:00Z", qualifyingTime: "2026-10-24T20:00:00Z", hasSprint: false, results: [], trackTimezone: "America/Chicago" },
    { name: "Mexican Grand Prix",      location: "Mexico City",      raceTime: "2026-11-01T20:00:00Z", qualifyingTime: "2026-10-31T21:00:00Z", hasSprint: false, results: [], trackTimezone: "America/Mexico_City" },
    { name: "Brazilian Grand Prix",    location: "Sao Paulo",        raceTime: "2026-11-08T17:00:00Z", qualifyingTime: "2026-11-07T18:00:00Z", hasSprint: false, results: [], trackTimezone: "America/Sao_Paulo" },
    { name: "Las Vegas Grand Prix",    location: "Las Vegas",        raceTime: "2026-11-21T06:00:00Z", qualifyingTime: "2026-11-20T06:00:00Z", hasSprint: false, results: [], trackTimezone: "America/Los_Angeles" },
    { name: "Qatar Grand Prix",        location: "Lusail",           raceTime: "2026-11-29T14:00:00Z", qualifyingTime: "2026-11-28T15:00:00Z", hasSprint: false, results: [], trackTimezone: "Asia/Qatar" },
    { name: "Abu Dhabi Grand Prix",    location: "Yas Marina",       raceTime: "2026-12-06T13:00:00Z", qualifyingTime: "2026-12-05T14:00:00Z", hasSprint: false, results: [], trackTimezone: "Asia/Dubai" },
];

// GUID: LIB_DATA-009-v03
// [Intent] Find the next upcoming race based on the current date by comparing race times.
//          Uses raceTime (not qualifyingTime) so sprint weekends are not skipped after SQ fires
//          but before the Sprint Race / GP has run. Returns the last race in the schedule if all
//          races are in the past (end-of-season fallback).
// [Inbound Trigger] Called by dashboard, predictions page, PubChat, and deadline banner components
//                   to determine which race to display and which deadline to count down to.
// [Downstream Impact] Changing the comparison field here affects which race is shown as "next"
//                     across the app. Prediction-lock enforcement is server-side and unaffected.
// @FIX: Changed qualifyingTime → raceTime. qualifyingTime = SQ on sprint weekends (fires Thu/Fri),
//       so the old logic skipped the Chinese GP entirely between SQ and the actual race.
export const findNextRace = () => {
    const now = new Date();
    return RaceSchedule.find(race => new Date(race.raceTime) > now) ?? RaceSchedule[RaceSchedule.length - 1];
};
