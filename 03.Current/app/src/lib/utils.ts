// GUID: LIB_UTILS-000-v03
// [Intent] Utility module providing CSS class name merging for Tailwind CSS.
//          Combines clsx conditional class logic with tailwind-merge conflict resolution.
// [Inbound Trigger] Imported by virtually every UI component that uses dynamic class names.
// [Downstream Impact] If this function changes behaviour, all component styling that uses cn() is affected.

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// GUID: LIB_UTILS-001-v03
// [Intent] Merge multiple CSS class values into a single string, resolving Tailwind CSS conflicts.
//          Uses clsx for conditional class composition and twMerge to deduplicate/resolve conflicting
//          Tailwind utilities (e.g., "p-2" and "p-4" resolve to "p-4").
// [Inbound Trigger] Called by any component passing dynamic or conditional class names to JSX elements.
// [Downstream Impact] All UI components depend on this for correct class merging. A breaking change here
//                     would cause styling regressions across the entire application.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
