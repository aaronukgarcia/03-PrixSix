
import { PlaceHolderImages } from './placeholder-images';

export interface Driver {
  id: string;
  name: string;
  number: number;
  team: string;
  imageId: string;
}

export const F1Drivers: Driver[] = [
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
    // 2026 Official F1 Calendar (24 races)
    { name: "Australian Grand Prix", location: "Melbourne", raceTime: "2026-03-08T05:00:00Z", qualifyingTime: "2026-03-07T06:00:00Z", hasSprint: false, results: [] },
    { name: "Chinese Grand Prix", location: "Shanghai", raceTime: "2026-03-15T07:00:00Z", qualifyingTime: "2026-03-13T07:00:00Z", hasSprint: true, results: [] },
    { name: "Japanese Grand Prix", location: "Suzuka", raceTime: "2026-03-29T06:00:00Z", qualifyingTime: "2026-03-28T07:00:00Z", hasSprint: false, results: [] },
    { name: "Bahrain Grand Prix", location: "Sakhir", raceTime: "2026-04-12T15:00:00Z", qualifyingTime: "2026-04-11T16:00:00Z", hasSprint: false, results: [] },
    { name: "Saudi Arabian Grand Prix", location: "Jeddah", raceTime: "2026-04-19T17:00:00Z", qualifyingTime: "2026-04-18T17:00:00Z", hasSprint: false, results: [] },
    { name: "Miami Grand Prix", location: "Miami", raceTime: "2026-05-03T20:00:00Z", qualifyingTime: "2026-05-01T21:00:00Z", hasSprint: true, results: [] },
    { name: "Canadian Grand Prix", location: "Montreal", raceTime: "2026-05-24T18:00:00Z", qualifyingTime: "2026-05-22T20:00:00Z", hasSprint: true, results: [] },
    { name: "Monaco Grand Prix", location: "Monaco", raceTime: "2026-06-07T13:00:00Z", qualifyingTime: "2026-06-06T14:00:00Z", hasSprint: false, results: [] },
    { name: "Spanish Grand Prix", location: "Barcelona", raceTime: "2026-06-14T13:00:00Z", qualifyingTime: "2026-06-13T14:00:00Z", hasSprint: false, results: [] },
    { name: "Austrian Grand Prix", location: "Spielberg", raceTime: "2026-06-28T13:00:00Z", qualifyingTime: "2026-06-27T14:00:00Z", hasSprint: false, results: [] },
    { name: "British Grand Prix", location: "Silverstone", raceTime: "2026-07-05T14:00:00Z", qualifyingTime: "2026-07-03T15:00:00Z", hasSprint: true, results: [] },
    { name: "Belgian Grand Prix", location: "Spa-Francorchamps", raceTime: "2026-07-19T13:00:00Z", qualifyingTime: "2026-07-18T14:00:00Z", hasSprint: false, results: [] },
    { name: "Hungarian Grand Prix", location: "Budapest", raceTime: "2026-07-26T13:00:00Z", qualifyingTime: "2026-07-25T14:00:00Z", hasSprint: false, results: [] },
    { name: "Dutch Grand Prix", location: "Zandvoort", raceTime: "2026-08-23T13:00:00Z", qualifyingTime: "2026-08-21T14:00:00Z", hasSprint: true, results: [] },
    { name: "Italian Grand Prix", location: "Monza", raceTime: "2026-09-06T13:00:00Z", qualifyingTime: "2026-09-05T14:00:00Z", hasSprint: false, results: [] },
    { name: "Spanish Grand Prix II", location: "Madrid", raceTime: "2026-09-13T13:00:00Z", qualifyingTime: "2026-09-12T14:00:00Z", hasSprint: false, results: [] },
    { name: "Azerbaijan Grand Prix", location: "Baku", raceTime: "2026-09-26T11:00:00Z", qualifyingTime: "2026-09-25T12:00:00Z", hasSprint: false, results: [] },
    { name: "Singapore Grand Prix", location: "Singapore", raceTime: "2026-10-11T12:00:00Z", qualifyingTime: "2026-10-09T13:00:00Z", hasSprint: true, results: [] },
    { name: "United States Grand Prix", location: "Austin", raceTime: "2026-10-25T19:00:00Z", qualifyingTime: "2026-10-24T20:00:00Z", hasSprint: false, results: [] },
    { name: "Mexican Grand Prix", location: "Mexico City", raceTime: "2026-11-01T20:00:00Z", qualifyingTime: "2026-10-31T21:00:00Z", hasSprint: false, results: [] },
    { name: "Brazilian Grand Prix", location: "Sao Paulo", raceTime: "2026-11-08T17:00:00Z", qualifyingTime: "2026-11-07T18:00:00Z", hasSprint: false, results: [] },
    { name: "Las Vegas Grand Prix", location: "Las Vegas", raceTime: "2026-11-21T06:00:00Z", qualifyingTime: "2026-11-20T06:00:00Z", hasSprint: false, results: [] },
    { name: "Qatar Grand Prix", location: "Lusail", raceTime: "2026-11-29T14:00:00Z", qualifyingTime: "2026-11-28T15:00:00Z", hasSprint: false, results: [] },
    { name: "Abu Dhabi Grand Prix", location: "Yas Marina", raceTime: "2026-12-06T13:00:00Z", qualifyingTime: "2026-12-05T14:00:00Z", hasSprint: false, results: [] },
];

export const findNextRace = () => {
    const now = new Date();
    // For demo purposes, if all races are in the past, return the last one.
    // In a real app, you might want to handle the end of a season differently.
    return RaceSchedule.find(race => new Date(race.qualifyingTime) > now) ?? RaceSchedule[RaceSchedule.length - 1];
};
