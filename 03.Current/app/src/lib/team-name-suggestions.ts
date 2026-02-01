// GUID: LIB_TEAM_NAME_SUGGESTIONS-000-v01
// [Intent] Shared module for dynamic F1-themed team name suggestions. Contains a curated pool
//          of ~150 funny names, a function to generate filtered suggestions, and email-match
//          detection to nudge users away from using their email as their team name.
// [Inbound Trigger] Imported by the team-name-suggestions API route and client-side pages.
// [Downstream Impact] Powers the Wand2 suggestion button and the "are you sure?" dialog on
//                     signup and complete-profile pages.

// GUID: LIB_TEAM_NAME_SUGGESTIONS-001-v01
// [Intent] Curated pool of ~150 F1 personality + pop culture mashup team names.
// [Inbound Trigger] Referenced by generateSuggestions().
// [Downstream Impact] Adding/removing entries changes the available suggestion pool.
export const TEAM_NAME_POOL: string[] = [
  // Driver puns
  "Toto Recall",
  "Leclerc Kent",
  "Max Power",
  "Shortcrust Piastri",
  "Checo Yourself",
  "Smooth Operator",
  "Vettel Attend",
  "Thorpe Park Ferme",
  "Lando Calrissian",
  "Hamilton Academical",
  "Alonso in Wonderland",
  "Stroll Patrol",
  "Danny Ric Roll",
  "Pierre Pressure",
  "Yuki Monster",
  "Bottas the Builder",
  "Ocon Air",
  "De Vries Squad",
  "Zhou Got This",
  "Sargent Pepper",
  "Albon and Clyde",
  "Magnussen Force",
  "Hulkenback",
  "Perez Hilton Racing",
  "Russell Brand Prix",
  "Norris McWhirter",
  "Sainz of the Times",
  "Lewis and Clark",
  "Charles in Charge",
  "Oscar Worthy",

  // Circuit & location puns
  "Baku to the Future",
  "Monaco Lisa",
  "Spa Day Every Day",
  "Monza Lisa Smile",
  "Jeddah Knight",
  "Silverstone Cold Fox",
  "Singapore Sling",
  "Suzuka Palooza",
  "Imola Lot of Fun",
  "Bahrain or Shine",
  "Abu Dhabi Do",
  "Interlagos United",
  "Zandvoort Notice",
  "Catalunya Dream",
  "Red Bull Ring Sting",
  "Hungaroring Ring",
  "Austin Powers GP",
  "Miami Vice Racing",
  "Las Vegas Lights",
  "Montreal Canadians GP",

  // Team & constructor puns
  "Haas-ta La Vista",
  "Red Bull in a China Shop",
  "Aston Martini",
  "Alphatauri Borealis",
  "McLaren and Present Danger",
  "Williams Shakespeare",
  "Ferrari Bueller",
  "Mercedes Bends",
  "Alpine About Nothing",
  "Sauber Kraut Racing",
  "Racing Point Break",
  "Lotus Position",
  "Brawn Supremacy",
  "Tyrrell and Error",
  "Jordan's No. 23 GP",

  // F1 terms & culture
  "Braking Bad",
  "DRS and Recreation",
  "Safety Car Karaoke",
  "Champagne Spraying Mantis",
  "Pit Stop Perfection",
  "Undercut Above",
  "Box Box Baby",
  "Tyre Whisperer",
  "Slipstream Supreme",
  "Dirty Air Force",
  "Full Beans Racing",
  "Lights Out and Away",
  "Formation Lap Dance",
  "Gravel Trap House",
  "Blue Flag Bonanza",
  "Penalty Points Hoarder",
  "Porpoising Dolphins",
  "Ground Effect Defect",
  "Halo There",
  "DRS Zone Defense",
  "Virtual Safety Car Pool",
  "Track Limits Testing",
  "Stewards Inquiry Mind",
  "Team Radio Silence",
  "Strategy Meltdown",
  "Soft Tyre Situation",
  "Hard Compound Interest",
  "Medium Rare Steak Out",
  "Rain Master Disaster",
  "Wet Weather Friends",

  // Pop culture mashups
  "The Fast and Furious Five",
  "Grand Prix Theft Auto",
  "Need for Speed Trap",
  "Cars But Real",
  "Top Gear Bottom",
  "Drive to Survive Club",
  "Lord of the Wings",
  "Game of Cones",
  "Breaking Point Guard",
  "The Oversteer Club",
  "Jurassic Spark Plug",
  "The Phantom Menace GP",
  "Mission Winnow Impossible",
  "Ctrl Alt De-Lap",
  "Error 404 Grip Not Found",
  "Wi-Fi in the Pitlane",
  "Buffering in Sector 3",
  "Upload to the Cloud Nine",

  // Food & drink
  "Espresso Martini GP",
  "Sunday Roast Racing",
  "Fish and Chicane",
  "Scone Pole Position",
  "Full English Breakfast Run",
  "Carbonara Copy",
  "Pasta La Vista Baby",
  "Tea Total Domination",
  "Flat White Flag",
  "Croissant Corner Speed",

  // Absurd & miscellaneous
  "My Other Car is an F1",
  "Weekend Warrior GP",
  "Armchair Aerodynamics",
  "Sofa So Good Racing",
  "Keyboard Warrior GP",
  "Spreadsheet Racing",
  "PowerPoint Presentation GP",
  "Data Driven Dreams",
  "Points Mean Prizes",
  "Fantasy League of Legends",
  "Predicted This All Along",
  "Lucky Guess Racing",
  "Crystal Ball GP",
  "Chaos Theory Racing",
  "Plot Armour Racing",
  "Main Character Energy GP",
  "Vibes Only Racing",
  "Trust the Process GP",
  "Just Here for Memes",
  "Certified Grid Lock",
];

// GUID: LIB_TEAM_NAME_SUGGESTIONS-002-v01
// [Intent] Shuffles the name pool, removes names already taken, and returns `count` suggestions.
// [Inbound Trigger] Called by the API route with existing team names from Firestore.
// [Downstream Impact] Returns an array of available team names for the client to display.
export function generateSuggestions(
  existingNames: string[],
  count: number = 50
): string[] {
  const existingSet = new Set(existingNames.map((n) => n.toLowerCase().trim()));

  // Filter out taken names
  const available = TEAM_NAME_POOL.filter(
    (name) => !existingSet.has(name.toLowerCase().trim())
  );

  // Fisher-Yates shuffle
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

// GUID: LIB_TEAM_NAME_SUGGESTIONS-003-v01
// [Intent] Detects if a team name appears to be derived from the user's email address.
//          Uses normalised containment and token matching to catch common patterns like
//          "Aaron Garcia" from "aaron@garcia.ltd" or "aarongarcia" from "aaron.garcia@email.com".
// [Inbound Trigger] Called on form submission before actually submitting, to show a nudge dialog.
// [Downstream Impact] Returns true if the team name looks email-derived, triggering the "are you sure?" dialog.
export function doesTeamNameMatchEmail(
  teamName: string,
  email: string
): boolean {
  if (!teamName || !email) return false;

  const localPart = email.split("@")[0];
  if (!localPart) return false;

  // Normalize: lowercase, strip dots/underscores/hyphens/plus signs/digits
  const normalizeStr = (s: string): string =>
    s.toLowerCase().replace(/[._\-+\d]/g, "");

  const normalizedTeamName = normalizeStr(teamName);
  const normalizedLocal = normalizeStr(localPart);

  // Direct containment check (min 3 chars to avoid false positives on short matches)
  if (
    normalizedLocal.length >= 3 &&
    normalizedTeamName.includes(normalizedLocal)
  ) {
    return true;
  }
  if (
    normalizedTeamName.length >= 3 &&
    normalizedLocal.includes(normalizedTeamName)
  ) {
    return true;
  }

  // Token matching: split email on common separators and check overlap
  const emailTokens = localPart
    .toLowerCase()
    .split(/[._\-+]/)
    .filter((t) => t.length >= 2);

  if (emailTokens.length === 0) return false;

  const teamNameLower = teamName.toLowerCase();
  const matchingTokens = emailTokens.filter((token) =>
    teamNameLower.includes(token)
  );

  // Match if >50% of email tokens found in team name
  return matchingTokens.length / emailTokens.length > 0.5;
}
