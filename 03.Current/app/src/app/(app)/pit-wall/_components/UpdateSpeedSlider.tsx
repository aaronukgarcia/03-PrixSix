// GUID: UPDATE_SPEED_SLIDER-000-v01
// [Intent] Compact slider controlling the live data polling interval.
//          Warns user when high-frequency polling is selected.
// [Inbound Trigger] Used by PitWallToolbar to expose update frequency control.
// [Downstream Impact] onChange drives usePitWallData polling interval.

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Slider } from '@/components/ui/slider';

// GUID: UPDATE_SPEED_SLIDER-001-v01
// [Intent] Props for the UpdateSpeedSlider component.
interface UpdateSpeedSliderProps {
  value: number; // seconds
  onChange: (seconds: number) => void;
  min?: number;
  max?: number;
  default?: number;
}

// GUID: UPDATE_SPEED_SLIDER-002-v01
// [Intent] Main UpdateSpeedSlider component. Renders labelled slider with
//          current value display and a high-data-use warning at low intervals.
export function UpdateSpeedSlider({
  value,
  onChange,
  min = 2,
  max = 60,
  default: _default = 10,
}: UpdateSpeedSliderProps) {
  const isHighFrequency = value < 5;

  function handleValueChange(vals: number[]) {
    const newVal = vals[0];
    if (typeof newVal === 'number') {
      onChange(newVal);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* Label */}
      <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap select-none">
        Update
      </span>

      {/* Slider */}
      <div className="w-24 flex-shrink-0">
        <Slider
          min={min}
          max={max}
          step={1}
          value={[value]}
          onValueChange={handleValueChange}
          className={[
            '[&_[data-radix-slider-thumb]]:bg-white',
            '[&_[data-radix-slider-thumb]]:border-0',
            '[&_[data-radix-slider-thumb]]:shadow-sm',
            '[&_[data-radix-slider-track]]:bg-slate-700',
            '[&_[data-radix-slider-range]]:bg-blue-500',
          ].join(' ')}
          aria-label={`Update interval: ${value} seconds`}
        />
      </div>

      {/* Value display */}
      <span className="font-mono text-xs tabular-nums w-8 text-right text-slate-300 select-none">
        {value}s
      </span>

      {/* High data use warning */}
      <AnimatePresence>
        {isHighFrequency && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 whitespace-nowrap select-none"
          >
            High data use
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
