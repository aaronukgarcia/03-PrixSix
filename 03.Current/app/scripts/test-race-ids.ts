import { RaceSchedule } from '../src/lib/data';
import { generateRaceId } from '../src/lib/normalize-race-id';

console.log('Testing race ID generation:\n');

for (const race of RaceSchedule) {
  const gpId = generateRaceId(race.name, 'gp');
  console.log(`${race.name} (GP): ${gpId}`);

  if (race.hasSprint) {
    const sprintId = generateRaceId(race.name, 'sprint');
    console.log(`${race.name} (Sprint): ${sprintId}`);
  }
}
