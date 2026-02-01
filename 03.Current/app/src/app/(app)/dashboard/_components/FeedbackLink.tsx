// GUID: COMPONENT_FEEDBACK_LINK-000-v03
// [Intent] Compact feedback entry point for the dashboard. Shows a single-line link that
//          expands to reveal the full FeedbackForm when clicked. Reduces dashboard clutter
//          while keeping feedback accessible.
// [Inbound Trigger] Rendered on the dashboard page below the hot news feed.
// [Downstream Impact] When expanded, renders FeedbackForm which writes to Firestore feedback collection.

'use client';

import { useState } from 'react';
import { Bug, ChevronRight, ChevronDown } from 'lucide-react';
import { FeedbackForm } from './FeedbackForm';

// GUID: COMPONENT_FEEDBACK_LINK-001-v03
// [Intent] Main component — renders a clickable row that toggles the FeedbackForm visibility.
// [Inbound Trigger] User clicks the feedback link on the dashboard.
// [Downstream Impact] Toggles FeedbackForm mount/unmount. No Firestore interaction until expanded.
export function FeedbackLink() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2"
      >
        <Bug className="h-4 w-4" />
        <span>Report a bug or suggest a new feature</span>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      {isExpanded && <FeedbackForm />}
    </div>
  );
}
