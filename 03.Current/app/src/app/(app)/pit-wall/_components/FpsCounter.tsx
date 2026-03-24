// GUID: FPS_COUNTER-000-v01
// [Intent] Lightweight FPS counter overlay for the track map.
//          Uses requestAnimationFrame to measure real frame rate.
//          Displayed at top-right of the track map area.
// [Inbound Trigger] Rendered in PitWallClient when zoomLevel >= 1.
// [Downstream Impact] Pure display — no state changes, no data flow.

'use client';

import { useState, useEffect, useRef } from 'react';

export function FpsCounter() {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let rafHandle: number;

    const tick = () => {
      framesRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 1000) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastTimeRef.current = now;
      }

      rafHandle = requestAnimationFrame(tick);
    };

    rafHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafHandle);
  }, []);

  return (
    <span className="text-[9px] font-mono tabular-nums text-slate-500">
      {fps} fps
    </span>
  );
}
