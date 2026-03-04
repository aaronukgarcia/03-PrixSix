// GUID: SCRIPT_SEED_OFFICIAL_TEAMS-000-v01
// [Type] Utility Script — one-shot, run once
// [Intent] Seed the official_teams Firestore collection with the full 2026 F1 driver-team
//          mapping. Driver numbers are the canonical join key to OpenF1 timing data.
//          Used by Team Lens view in ThePaddockPubChat.
// [Usage] npx ts-node --project app/tsconfig.scripts.json scripts/seed-official-teams.ts

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../service-account.json');
if (!getApps().length) initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
const db = getFirestore();

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

interface TeamDoc {
  teamName: string;
  teamColour: string;       // hex without #
  openf1TeamName: string;   // team name as returned by OpenF1 API
  season: number;
  drivers: { surname: string; fullName: string; number: number }[];
}

const TEAMS_2026: Record<string, TeamDoc> = {
  mclaren: {
    teamName: 'McLaren',
    teamColour: 'FF8000',
    openf1TeamName: 'McLaren',
    season: 2026,
    drivers: [
      { surname: 'Norris',  fullName: 'Lando Norris',  number: 1  },
      { surname: 'Piastri', fullName: 'Oscar Piastri', number: 81 },
    ],
  },
  mercedes: {
    teamName: 'Mercedes',
    teamColour: '27F4D2',
    openf1TeamName: 'Mercedes',
    season: 2026,
    drivers: [
      { surname: 'Russell',   fullName: 'George Russell',         number: 63 },
      { surname: 'Antonelli', fullName: 'Andrea Kimi Antonelli',  number: 12 },
    ],
  },
  red_bull: {
    teamName: 'Red Bull',
    teamColour: '3671C6',
    openf1TeamName: 'Red Bull Racing',
    season: 2026,
    drivers: [
      { surname: 'Verstappen', fullName: 'Max Verstappen', number: 3 },
      { surname: 'Hadjar',     fullName: 'Isack Hadjar',   number: 6 },
    ],
  },
  ferrari: {
    teamName: 'Ferrari',
    teamColour: 'E8002D',
    openf1TeamName: 'Ferrari',
    season: 2026,
    drivers: [
      { surname: 'Leclerc',  fullName: 'Charles Leclerc', number: 16 },
      { surname: 'Hamilton', fullName: 'Lewis Hamilton',  number: 44 },
    ],
  },
  williams: {
    teamName: 'Williams',
    teamColour: '00A0DE',
    openf1TeamName: 'Williams',
    season: 2026,
    drivers: [
      { surname: 'Sainz', fullName: 'Carlos Sainz',    number: 55 },
      { surname: 'Albon', fullName: 'Alexander Albon', number: 23 },
    ],
  },
  racing_bulls: {
    teamName: 'Racing Bulls',
    teamColour: '6692FF',
    openf1TeamName: 'RB',
    season: 2026,
    drivers: [
      { surname: 'Lawson',   fullName: 'Liam Lawson',    number: 30 },
      { surname: 'Lindblad', fullName: 'Arvid Lindblad', number: 41 },
    ],
  },
  aston_martin: {
    teamName: 'Aston Martin',
    teamColour: '358C75',
    openf1TeamName: 'Aston Martin',
    season: 2026,
    drivers: [
      { surname: 'Alonso', fullName: 'Fernando Alonso', number: 14 },
      { surname: 'Stroll',  fullName: 'Lance Stroll',    number: 18 },
    ],
  },
  alpine: {
    teamName: 'Alpine',
    teamColour: 'FF87BC',
    openf1TeamName: 'Alpine',
    season: 2026,
    drivers: [
      { surname: 'Gasly',     fullName: 'Pierre Gasly',     number: 10 },
      { surname: 'Colapinto', fullName: 'Franco Colapinto', number: 43 },
    ],
  },
  audi: {
    teamName: 'Audi',
    teamColour: '52E252',
    openf1TeamName: 'Audi',
    season: 2026,
    drivers: [
      { surname: 'Hulkenberg', fullName: 'Nico Hulkenberg',   number: 27 },
      { surname: 'Bortoleto',  fullName: 'Gabriel Bortoleto', number: 5  },
    ],
  },
  haas: {
    teamName: 'Haas',
    teamColour: 'B6BABD',
    openf1TeamName: 'Haas F1 Team',
    season: 2026,
    drivers: [
      { surname: 'Ocon',    fullName: 'Esteban Ocon',   number: 31 },
      { surname: 'Bearman', fullName: 'Oliver Bearman', number: 87 },
    ],
  },
  cadillac: {
    teamName: 'Cadillac',
    teamColour: '1E3A6E',
    openf1TeamName: 'Cadillac',
    season: 2026,
    drivers: [
      { surname: 'Bottas', fullName: 'Valtteri Bottas', number: 77 },
      { surname: 'Perez',  fullName: 'Sergio Perez',    number: 11 },
    ],
  },
};

async function seed() {
  log('Seeding official_teams collection (2026 F1 season)...');
  const batch = db.batch();

  for (const [id, data] of Object.entries(TEAMS_2026)) {
    const ref = db.collection('official_teams').doc(id);
    batch.set(ref, data);
    log(`  ✓ ${id}: ${data.drivers.map(d => `${d.surname} #${d.number}`).join(' | ')}`);
  }

  await batch.commit();
  log(`\nDone — ${Object.keys(TEAMS_2026).length} team documents written to official_teams.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
