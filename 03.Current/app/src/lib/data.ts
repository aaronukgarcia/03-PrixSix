
import { PlaceHolderImages } from './placeholder-images';

export interface Driver {
  id: string;
  name: string;
  number: number;
  team: string;
  imageId: string;
}

export const F1Drivers: Driver[] = [
  { id: 'verstappen', name: 'Verstappen', number: 1, team: 'Red Bull Racing', imageId: 'max-verstappen' },
  { id: 'perez', name: 'Perez', number: 11, team: 'Red Bull Racing', imageId: 'sergio-perez' },
  { id: 'hamilton', name: 'Hamilton', number: 44, team: 'Mercedes', imageId: 'lewis-hamilton' },
  { id: 'russell', name: 'Russell', number: 63, team: 'Mercedes', imageId: 'george-russell' },
  { id: 'leclerc', name: 'Leclerc', number: 16, team: 'Ferrari', imageId: 'charles-leclerc' },
  { id: 'sainz', name: 'Sainz', number: 55, team: 'Ferrari', imageId: 'carlos-sainz' },
  { id: 'norris', name: 'Norris', number: 4, team: 'McLaren', imageId: 'lando-norris' },
  { id: 'piastri', name: 'Piastri', number: 81, team: 'McLaren', imageId: 'oscar-piastri' },
  { id: 'alonso', name: 'Alonso', number: 14, team: 'Aston Martin', imageId: 'fernando-alonso' },
  { id: 'stroll', name: 'Stroll', number: 18, team: 'Aston Martin', imageId: 'lance-stroll' },
  { id: 'gasly', name: 'Gasly', number: 10, team: 'Alpine', imageId: 'pierre-gasly' },
  { id: 'ocon', name: 'Ocon', number: 31, team: 'Alpine', imageId: 'esteban-ocon' },
  { id: 'albon', name: 'Albon', number: 23, team: 'Williams', imageId: 'alexander-albon' },
  { id: 'sargeant', name: 'Sargeant', number: 2, team: 'Williams', imageId: 'logan-sargeant' },
  { id: 'tsunoda', name: 'Tsunoda', number: 22, team: 'RB', imageId: 'yuki-tsunoda' },
  { id: 'ricciardo', name: 'Ricciardo', number: 3, team: 'RB', imageId: 'daniel-ricciardo' },
  { id: 'bottas', name: 'Bottas', number: 77, team: 'Sauber', imageId: 'valtteri-bottas' },
  { id: 'zhou', name: 'Guanyu', number: 24, team: 'Sauber', imageId: 'zhou-guanyu' },
  { id: 'hulkenberg', name: 'Hulkenberg', number: 27, team: 'Haas F1 Team', imageId: 'nico-hulkenberg' },
  { id: 'magnussen', name: 'Magnussen', number: 20, team: 'Haas F1 Team', imageId: 'kevin-magnussen' },
];

export const getDriverImage = (driverId: string) => {
    const driver = F1Drivers.find(d => d.id === driverId);
    const image = PlaceHolderImages.find(p => p.id === driver?.imageId);
    return image?.imageUrl || 'https://picsum.photos/seed/placeholder/100/100';
}

export interface Race {
  name: string;
  qualifyingTime: string; // UTC ISO string
  raceTime: string; // UTC ISO string
  location: string;
  hasSprint: boolean;
  results: (string | null)[];
}

export const RaceSchedule: Race[] = [
    { name: "Australian Grand Prix", location: "Melbourne", raceTime: "2026-03-15T05:00:00Z", qualifyingTime: "2026-03-14T05:00:00Z", hasSprint: false, results: [] },
    { name: "Chinese Grand Prix", location: "Shanghai", raceTime: "2026-04-05T07:00:00Z", qualifyingTime: "2026-04-04T07:00:00Z", hasSprint: true, results: [] },
    { name: "Japanese Grand Prix", location: "Suzuka", raceTime: "2026-04-19T05:00:00Z", qualifyingTime: "2026-04-18T06:00:00Z", hasSprint: false, results: [] },
    { name: "Bahrain Grand Prix", location: "Sakhir", raceTime: "2026-05-03T14:00:00Z", qualifyingTime: "2026-05-02T15:00:00Z", hasSprint: false, results: [] },
    { name: "Saudi Arabian Grand Prix", location: "Jeddah", raceTime: "2026-05-10T16:00:00Z", qualifyingTime: "2026-05-09T17:00:00Z", hasSprint: false, results: [] },
    { name: "Emilia Romagna Grand Prix", location: "Imola", raceTime: "2026-05-24T13:00:00Z", qualifyingTime: "2026-05-23T14:00:00Z", hasSprint: false, results: [] },
    { name: "Monaco Grand Prix", location: "Monaco", raceTime: "2026-05-31T13:00:00Z", qualifyingTime: "2026-05-30T14:00:00Z", hasSprint: false, results: [] },
    { name: "Spanish Grand Prix", location: "Barcelona", raceTime: "2026-06-07T13:00:00Z", qualifyingTime: "2026-06-06T14:00:00Z", hasSprint: false, results: [] },
    { name: "Canadian Grand Prix", location: "Montreal", raceTime: "2026-06-21T18:00:00Z", qualifyingTime: "2026-06-20T20:00:00Z", hasSprint: false, results: [] },
    { name: "Austrian Grand Prix", location: "Spielberg", raceTime: "2026-07-05T13:00:00Z", qualifyingTime: "2026-07-04T14:30:00Z", hasSprint: true, results: [] },
    { name: "British Grand Prix", location: "Silverstone", raceTime: "2026-07-19T14:00:00Z", qualifyingTime: "2026-07-18T14:00:00Z", hasSprint: false, results: [] },
    { name: "Belgian Grand Prix", location: "Spa-Francorchamps", raceTime: "2026-07-26T13:00:00Z", qualifyingTime: "2026-07-25T14:00:00Z", hasSprint: true, results: [] },
    { name: "Hungarian Grand Prix", location: "Budapest", raceTime: "2026-08-02T13:00:00Z", qualifyingTime: "2026-08-01T14:00:00Z", hasSprint: false, results: [] },
    { name: "Dutch Grand Prix", location: "Zandvoort", raceTime: "2026-08-30T13:00:00Z", qualifyingTime: "2026-08-29T14:00:00Z", hasSprint: false, results: [] },
    { name: "Italian Grand Prix", location: "Monza", raceTime: "2026-09-06T13:00:00Z", qualifyingTime: "2026-09-05T14:00:00Z", hasSprint: false, results: [] },
    { name: "Azerbaijan Grand Prix", location: "Baku", raceTime: "2026-09-20T11:00:00Z", qualifyingTime: "2026-09-19T12:00:00Z", hasSprint: false, results: [] },
    { name: "Singapore Grand Prix", location: "Singapore", raceTime: "2026-09-27T12:00:00Z", qualifyingTime: "2026-09-26T13:00:00Z", hasSprint: false, results: [] },
    { name: "United States Grand Prix", location: "Austin", raceTime: "2026-10-25T19:00:00Z", qualifyingTime: "2026-10-24T22:00:00Z", hasSprint: true, results: [] },
    { name: "Mexican Grand Prix", location: "Mexico City", raceTime: "2026-11-01T20:00:00Z", qualifyingTime: "2026-10-31T21:00:00Z", hasSprint: false, results: [] },
    { name: "Brazilian Grand Prix", location: "Sao Paulo", raceTime: "2026-11-08T17:00:00Z", qualifyingTime: "2026-11-07T18:30:00Z", hasSprint: true, results: [] },
    { name: "Las Vegas Grand Prix", location: "Las Vegas", raceTime: "2026-11-22T06:00:00Z", qualifyingTime: "2026-11-21T06:00:00Z", hasSprint: false, results: [] },
    { name: "Qatar Grand Prix", location: "Lusail", raceTime: "2026-11-29T17:00:00Z", qualifyingTime: "2026-11-28T14:00:00Z", hasSprint: true, results: [] },
    { name: "Abu Dhabi Grand Prix", location: "Yas Marina", raceTime: "2026-12-06T13:00:00Z", qualifyingTime: "2026-12-05T14:00:00Z", hasSprint: false, results: [] },
];

export const findNextRace = () => {
    const now = new Date();
    // For demo purposes, if all races are in the past, return the last one.
    // In a real app, you might want to handle the end of a season differently.
    return RaceSchedule.find(race => new Date(race.qualifyingTime) > now) ?? RaceSchedule[RaceSchedule.length - 1];
};
