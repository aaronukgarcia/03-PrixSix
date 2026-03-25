// GUID: PIT_WALL_COLUMNS-000-v01
// [Intent] Column definitions for the Pit Wall race data table.
//          Each column has a key, label, default visibility, width, alignment.
// [Inbound Trigger] Used by PitWallRaceTable and ColumnSelector.
// [Downstream Impact] Changes here affect all table layout calculations.

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  width: number; // px
  align: 'left' | 'right' | 'center';
  sortable: boolean;
  description: string;
  alwaysVisible?: boolean; // cannot be toggled off
}

// GUID: PIT_WALL_COLUMNS-001-v01
// [Intent] Complete ordered list of all Pit Wall table columns.
export const PIT_WALL_COLUMNS: ColumnDef[] = [
  { key: 'position',  label: 'POS',    defaultVisible: true,  width: 44,  align: 'center', sortable: true,  alwaysVisible: true,  description: 'Current race position' },
  { key: 'driver',    label: 'DRIVER', defaultVisible: true,  width: 120, align: 'left',   sortable: false, alwaysVisible: true,  description: 'Driver code and team colour' },
  { key: 'radio',     label: '📻',     defaultVisible: true,  width: 36,  align: 'center', sortable: false, alwaysVisible: true,  description: 'Team radio — unread indicator' },
  { key: 'gap',       label: 'GAP',    defaultVisible: true,  width: 70,  align: 'right',  sortable: false, description: 'Gap to race leader' },
  { key: 'interval',  label: 'INT',    defaultVisible: true,  width: 70,  align: 'right',  sortable: false, description: 'Interval to car ahead' },
  { key: 'lastLap',   label: 'LAST',   defaultVisible: true,  width: 88,  align: 'right',  sortable: true,  description: 'Last lap time' },
  { key: 'bestLap',   label: 'BEST',   defaultVisible: true,  width: 88,  align: 'right',  sortable: true,  description: 'Best lap time this session' },
  { key: 'sector1',   label: 'S1',     defaultVisible: true,  width: 66,  align: 'right',  sortable: false, description: 'Sector 1 time (last lap)' },
  { key: 'sector2',   label: 'S2',     defaultVisible: true,  width: 66,  align: 'right',  sortable: false, description: 'Sector 2 time (last lap)' },
  { key: 'sector3',   label: 'S3',     defaultVisible: true,  width: 66,  align: 'right',  sortable: false, description: 'Sector 3 time (last lap)' },
  { key: 'tyre',      label: 'CMP',    defaultVisible: true,  width: 48,  align: 'center', sortable: false, description: 'Current tyre compound' },
  { key: 'tyreAge',   label: 'AGE',    defaultVisible: true,  width: 44,  align: 'right',  sortable: true,  description: 'Laps on current tyre set' },
  { key: 'lap',       label: 'LAP',    defaultVisible: true,  width: 44,  align: 'center', sortable: false, description: 'Current lap number' },
  { key: 'drs',       label: 'OT',     defaultVisible: false, width: 40,  align: 'center', sortable: false, description: 'Overtake Mode active/inactive (2026: replaces DRS)' },
  { key: 'speed',     label: 'SPD',    defaultVisible: false, width: 54,  align: 'right',  sortable: false, description: 'Current speed (km/h)' },
  { key: 'throttle',  label: 'THR',    defaultVisible: false, width: 52,  align: 'right',  sortable: false, description: 'Throttle application (%)' },
  { key: 'pitstops',  label: 'PIT',    defaultVisible: false, width: 40,  align: 'center', sortable: true,  description: 'Number of pit stops made' },
];

// GUID: PIT_WALL_COLUMNS-002-v01
// [Intent] Derive CSS grid-template-columns string from visible column keys.
export function buildGridTemplate(visibleKeys: string[]): string {
  return visibleKeys
    .map(key => {
      const col = PIT_WALL_COLUMNS.find(c => c.key === key);
      return col ? `${col.width}px` : '60px';
    })
    .join(' ');
}

// GUID: PIT_WALL_COLUMNS-003-v01
// [Intent] Get default visible column keys for initial settings.
export function getDefaultVisibleColumns(): string[] {
  return PIT_WALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
}
