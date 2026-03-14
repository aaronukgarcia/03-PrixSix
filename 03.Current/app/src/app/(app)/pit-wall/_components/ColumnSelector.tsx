// GUID: COLUMN_SELECTOR-000-v01
// [Intent] Popover-based column visibility toggle for the Pit Wall race table.
// [Inbound Trigger] Used by PitWallToolbar.
// [Downstream Impact] Drives visibleColumns state in parent, which controls
//                     which table columns render and grid layout.

'use client';

import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { PIT_WALL_COLUMNS } from '../_types/columns';

// GUID: COLUMN_SELECTOR-001-v01
// [Intent] Props for the ColumnSelector component.
interface ColumnSelectorProps {
  visibleColumns: string[];
  onToggle: (key: string) => void;
}

// GUID: COLUMN_SELECTOR-002-v01
// [Intent] Main ColumnSelector component. Renders a trigger button that opens
//          a popover listing all columns with checkboxes for toggling visibility.
//          Columns marked alwaysVisible are shown checked and disabled.
export function ColumnSelector({ visibleColumns, onToggle }: ColumnSelectorProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-slate-400 hover:text-slate-200 gap-1.5 h-7 px-2"
          aria-label="Toggle column visibility"
        >
          <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="uppercase tracking-wider">Columns</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-52 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl"
        align="end"
        sideOffset={6}
      >
        <p className="text-[10px] text-slate-500 uppercase tracking-wider px-1 mb-2 select-none">
          Visible columns
        </p>

        <ul className="space-y-0.5">
          {PIT_WALL_COLUMNS.map((col) => {
            const isChecked = visibleColumns.includes(col.key);
            const isLocked = col.alwaysVisible === true;

            return (
              <li key={col.key}>
                <label
                  className={[
                    'flex items-center gap-2 py-1 px-1 rounded select-none',
                    isLocked
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-slate-800 cursor-pointer',
                  ].join(' ')}
                >
                  <Checkbox
                    checked={isChecked}
                    disabled={isLocked}
                    onCheckedChange={() => {
                      if (!isLocked) onToggle(col.key);
                    }}
                    className="w-3.5 h-3.5 border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 flex-shrink-0"
                    aria-label={`Toggle ${col.label} column`}
                  />

                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-slate-300 font-medium leading-tight">
                      {col.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 leading-tight truncate">
                      {col.description}
                    </span>
                  </span>

                  {isLocked && (
                    <span
                      className="text-[9px] text-slate-600 uppercase tracking-wide flex-shrink-0"
                      aria-label="Always visible"
                    >
                      lock
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
