// GUID: WEATHER_STRIP-000-v01
// [Intent] Compact horizontal weather data strip for the Pit Wall header.
//          Shows air temp, track temp, wind, rain status, and humidity.
// [Inbound Trigger] Used by PitWallHeader.
// [Downstream Impact] Visual-only — no state side-effects.

'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WeatherSnapshot } from '../_types/pit-wall.types';

// GUID: WEATHER_STRIP-001-v01
// [Intent] Props for the WeatherStrip component.
interface WeatherStripProps {
  weather: WeatherSnapshot | null;
  className?: string;
}

// GUID: WEATHER_STRIP-002-v01
// [Intent] Derive colour class for air temperature value.
function airTempColour(temp: number): string {
  if (temp < 15) return 'text-blue-400';
  if (temp > 30) return 'text-orange-400';
  return 'text-slate-300';
}

// GUID: WEATHER_STRIP-003-v01
// [Intent] Compass arrow SVG rotated to wind direction (degrees from North).
function WindArrow({ degrees }: { degrees: number }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{ transform: `rotate(${degrees}deg)`, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {/* Simple upward arrow — rotated by wind direction */}
      <path
        d="M6 1 L9 9 L6 7 L3 9 Z"
        fill="currentColor"
        className="text-slate-400"
      />
    </svg>
  );
}

// GUID: WEATHER_STRIP-004-v01
// [Intent] Animated rain intensity bar using blue fill proportional to 0-255 value.
function RainIntensityBar({ intensity }: { intensity: number }) {
  const pct = Math.min(100, Math.max(0, (intensity / 255) * 100));
  return (
    <span
      className="inline-block w-16 h-1.5 rounded bg-slate-700 overflow-hidden align-middle"
      aria-label={`Rain intensity ${Math.round(pct)}%`}
      title={`Rain intensity ${Math.round(pct)}%`}
    >
      <span
        className="block h-full rounded bg-blue-500 transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

// GUID: WEATHER_STRIP-005-v01
// [Intent] Animated rain icon — pulses when rainfall is active.
function RainIcon() {
  return (
    <motion.span
      animate={{ opacity: [1, 0.5, 1] }}
      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
      aria-label="Rain"
      role="img"
      style={{ display: 'inline-block' }}
    >
      🌧
    </motion.span>
  );
}

// GUID: WEATHER_STRIP-006-v01
// [Intent] Main WeatherStrip component. Renders a horizontal strip of weather
//          data items, fading in when data becomes available.
export function WeatherStrip({ weather, className = '' }: WeatherStripProps) {
  const items = useMemo(() => {
    if (!weather) return [];

    const result: React.ReactNode[] = [];

    // Air temperature
    if (weather.airTemp !== null) {
      result.push(
        <span key="air" className="flex items-center gap-1" title="Air temperature">
          <span role="img" aria-label="thermometer">🌡</span>
          <span className={airTempColour(weather.airTemp)}>
            {weather.airTemp.toFixed(1)}°C
          </span>
        </span>
      );
    }

    // Track temperature
    if (weather.trackTemp !== null) {
      result.push(
        <span key="track" className="text-slate-400" title="Track temperature">
          TRK {weather.trackTemp.toFixed(1)}°C
        </span>
      );
    }

    // Wind
    if (weather.windSpeed !== null) {
      result.push(
        <span key="wind" className="flex items-center gap-1 text-slate-300" title="Wind speed and direction">
          <span role="img" aria-label="wind">💨</span>
          <span>{Math.round(weather.windSpeed)}km/h</span>
          {weather.windDirection !== null && (
            <WindArrow degrees={weather.windDirection} />
          )}
        </span>
      );
    }

    // Rain status
    if (weather.rainfall) {
      result.push(
        <span key="rain" className="flex items-center gap-1" title="Rain">
          <RainIcon />
          {weather.rainIntensity !== null && weather.rainIntensity > 0 && (
            <RainIntensityBar intensity={weather.rainIntensity} />
          )}
        </span>
      );
    }

    // Humidity
    if (weather.humidity !== null) {
      result.push(
        <span key="hum" className="text-slate-500" title="Humidity">
          HUM {Math.round(weather.humidity)}%
        </span>
      );
    }

    return result;
  }, [weather]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {weather === null ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`text-slate-600 text-xs font-mono ${className}`}
          aria-label="Weather data unavailable"
        >
          --
        </motion.div>
      ) : (
        <motion.div
          key="data"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className={`flex items-center gap-4 text-xs font-mono ${className}`}
          aria-label="Weather conditions"
        >
          {items.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {item}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
