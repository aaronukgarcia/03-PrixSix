// GUID: RADIO_ICON-000-v01
// [Intent] Team radio status icon with unread pulse animation and mute state.
// [Inbound Trigger] Used by PitWallRaceTable radio column.
// [Downstream Impact] onClick triggers radio panel zoom in parent.

'use client';

import { motion } from 'framer-motion';
import { Radio, RadioTower } from 'lucide-react';

// GUID: RADIO_ICON-001-v01
// [Intent] Props for the RadioIcon component.
interface RadioIconProps {
  driverNumber: number;
  hasUnread: boolean;
  isMuted: boolean;
  unreadCount: number;
  onClick: () => void;
  className?: string;
}

// GUID: RADIO_ICON-002-v01
// [Intent] Pulsing orange dot shown when driver has unread radio messages.
function UnreadPulseDot() {
  return (
    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
      <motion.span
        className="w-2 h-2 bg-orange-500 rounded-full block"
        animate={{
          scale: [1, 1.4, 1],
          opacity: [1, 0.6, 1],
        }}
        transition={{
          repeat: Infinity,
          duration: 1.5,
          ease: 'easeInOut',
        }}
      />
    </span>
  );
}

// GUID: RADIO_ICON-003-v01
// [Intent] Badge showing unread count when count > 1.
function UnreadCountBadge({ count }: { count: number }) {
  return (
    <span
      className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white rounded-full flex items-center justify-center pointer-events-none"
      style={{ fontSize: '9px', lineHeight: 1 }}
      aria-label={`${count} unread messages`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

// GUID: RADIO_ICON-004-v01
// [Intent] Diagonal mute line SVG overlay drawn over the radio icon.
function MuteLine() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <line
        x1="2"
        y1="14"
        x2="14"
        y2="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
}

// GUID: RADIO_ICON-005-v01
// [Intent] Main RadioIcon component. Renders base icon, unread indicator,
//          mute overlay, and count badge based on props state.
export function RadioIcon({
  driverNumber,
  hasUnread,
  isMuted,
  unreadCount,
  onClick,
  className = '',
}: RadioIconProps) {
  const iconColour = isMuted
    ? 'text-slate-600'
    : hasUnread
    ? 'text-orange-400'
    : 'text-slate-400';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative cursor-pointer p-1 hover:text-slate-200 transition-colors rounded ${iconColour} ${className}`}
      aria-label={
        isMuted
          ? `Driver ${driverNumber} radio muted`
          : hasUnread
          ? `Driver ${driverNumber} has ${unreadCount} unread radio message${unreadCount !== 1 ? 's' : ''}`
          : `Driver ${driverNumber} radio`
      }
      title={isMuted ? 'Muted' : hasUnread ? `${unreadCount} unread` : 'No new messages'}
    >
      <span className="relative inline-flex w-4 h-4">
        {isMuted ? (
          <>
            <RadioTower className="w-4 h-4" aria-hidden="true" />
            <MuteLine />
          </>
        ) : (
          <Radio className="w-4 h-4" aria-hidden="true" />
        )}

        {/* Unread indicators — only when not muted */}
        {!isMuted && hasUnread && unreadCount <= 1 && <UnreadPulseDot />}
        {!isMuted && unreadCount > 1 && <UnreadCountBadge count={unreadCount} />}
      </span>
    </button>
  );
}
