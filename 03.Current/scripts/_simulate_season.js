// GUID: SCRIPT-TEST-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Testing
// [Intent] Simulate a full Prix Six season using local driver and scoring data — validates the scoring engine without Firestore.
// [Usage] node scripts/_simulate_season.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//

const fs = require('fs');

// --- CONSTANTS from scoring-rules.ts ---
const SCORING_POINTS = {
  exactPosition: 6,
  onePositionOff: 4,
  twoPositionsOff: 3,
  threeOrMoreOff: 2,
  bonusAll6: 10,
};

function calculateDriverPoints(predictedPosition, actualPosition) {
  if (actualPosition === -1 || actualPosition < 0 || actualPosition > 5) return 0;
  const positionDiff = Math.abs(predictedPosition - actualPosition);
  if (positionDiff === 0) return SCORING_POINTS.exactPosition;
  if (positionDiff === 1) return SCORING_POINTS.onePositionOff;
  if (positionDiff === 2) return SCORING_POINTS.twoPositionsOff;
  return SCORING_POINTS.threeOrMoreOff;
}

// --- DATA from data.ts (Simplified) ---
const DRIVERS = [
  'verstappen', 'hadjar', 'leclerc', 'hamilton', 'norris', 'piastri',
  'russell', 'antonelli', 'alonso', 'stroll'
]; // Top 10 for simulation

const RACES = [
    { name: "Australian Grand Prix", hasSprint: false },
    { name: "Chinese Grand Prix", hasSprint: true },
    { name: "Japanese Grand Prix", hasSprint: false },
    { name: "Bahrain Grand Prix", hasSprint: false },
    { name: "Saudi Arabian Grand Prix", hasSprint: false },
    { name: "Miami Grand Prix", hasSprint: true },
    { name: "Canadian Grand Prix", hasSprint: false },
    { name: "Monaco Grand Prix", hasSprint: false },
    { name: "Spanish Grand Prix", hasSprint: false },
    { name: "Austrian Grand Prix", hasSprint: false },
    { name: "British Grand Prix", hasSprint: true },
    { name: "Belgian Grand Prix", hasSprint: false },
    { name: "Hungarian Grand Prix", hasSprint: false },
    { name: "Dutch Grand Prix", hasSprint: true },
    { name: "Italian Grand Prix", hasSprint: false },
    { name: "Spanish Grand Prix II", hasSprint: false },
    { name: "Azerbaijan Grand Prix", hasSprint: false },
    { name: "Singapore Grand Prix", hasSprint: true },
    { name: "United States Grand Prix", hasSprint: false },
    { name: "Mexican Grand Prix", hasSprint: false },
    { name: "Brazilian Grand Prix", hasSprint: false },
    { name: "Las Vegas Grand Prix", hasSprint: false },
    { name: "Qatar Grand Prix", hasSprint: false },
    { name: "Abu Dhabi Grand Prix", hasSprint: false },
];

const TEAMS = ['Gem-Alpha', 'Gem-Bravo', 'Gem-Charlie'];

// --- HELPERS ---
function shuffle(array) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

function generateRaceId(raceName, type) {
  const base = raceName.replace(/\s+/g, '-');
  return type === 'gp' ? `${base}-GP` : `${base}-Sprint`;
}

// --- SIMULATION ---
const simulation = {
  meta: {
    description: "Logical simulation of the 2026 Season for 3 teams",
    generatedAt: new Date().toISOString(),
    teams: TEAMS,
    driversPool: DRIVERS,
    instructions: [
      "1. Run `node _simulate_season.js` to regenerate this file with new random outcomes.",
      "2. Compare `season[i].teamResults[j].score` with the application's actual scoring logic.",
      "3. Verify that `cumulativeScore` matches the sum of previous scores.",
      "4. Verify that `standingsSnapshot` ranks teams correctly by points.",
      "5. Check `raceId` formats against `app/src/lib/normalize-race-id.ts` to ensure consistency."
    ]
  },
  season: []
};

const standings = {
  'Gem-Alpha': 0,
  'Gem-Bravo': 0,
  'Gem-Charlie': 0
};

// Start simulation
RACES.forEach(race => {
  const events = [];
  if (race.hasSprint) events.push('sprint');
  events.push('gp');

  events.forEach(eventType => {
    const raceId = generateRaceId(race.name, eventType);
    const actualResult = shuffle(DRIVERS).slice(0, 6); // Top 6

    const raceData = {
      raceId: raceId,
      raceName: eventType === 'sprint' ? `${race.name} - Sprint` : race.name,
      eventType: eventType,
      actualResult: actualResult,
      teamResults: []
    };

    TEAMS.forEach(team => {
      // Generate prediction (sometimes random, sometimes good)
      const prediction = shuffle(DRIVERS).slice(0, 6);
      
      let score = 0;
      let correctCount = 0;
      const breakdown = [];

      prediction.forEach((driver, predIndex) => {
        const actualIndex = actualResult.indexOf(driver);
        const points = calculateDriverPoints(predIndex, actualIndex);
        score += points;
        
        if (actualIndex !== -1) correctCount++;
        
        breakdown.push({
          driver,
          predictedPos: predIndex + 1,
          actualPos: actualIndex !== -1 ? actualIndex + 1 : 'DNF/Out',
          points
        });
      });

      if (correctCount === 6) {
        score += SCORING_POINTS.bonusAll6;
        breakdown.push({ bonus: 'Perfect 6', points: 10 });
      }

      standings[team] += score;

      raceData.teamResults.push({
        team,
        prediction,
        score,
        cumulativeScore: standings[team],
        breakdown
      });
    });

    // Rank standings for this race
    raceData.standingsSnapshot = Object.entries(standings)
      .sort(([,a], [,b]) => b - a)
      .map(([team, points], index) => ({ rank: index + 1, team, points }));

    simulation.season.push(raceData);
  });
});

fs.writeFileSync('Gemini-Simulate2026.json', JSON.stringify(simulation, null, 2));
console.log('Simulation written to Gemini-Simulate2026.json');
