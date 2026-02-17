// GUID: LIB_UTILS-000-v04
// @SECURITY_FIX: Added maskPin() utility to prevent plaintext PIN logging (EMAIL-006).
// [Intent] Utility module providing CSS class name merging for Tailwind CSS and sensitive data masking.
//          Combines clsx conditional class logic with tailwind-merge conflict resolution.
//          Provides PIN masking to prevent credential leaks in logs and database.
// [Inbound Trigger] Imported by virtually every UI component that uses dynamic class names. Also used by email.ts for PIN redaction.
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

// GUID: LIB_UTILS-002-v01
// @SECURITY_FIX: Prevent plaintext PIN logging in email_logs collection (EMAIL-006 fix).
// [Intent] Mask sensitive PIN/password data before logging to Firestore or console.
//          Returns a fixed-length masking string ('••••••') regardless of actual PIN length
//          to prevent length-based information disclosure.
// [Inbound Trigger] Called by email.ts before logging PIN values to email_logs collection.
// [Downstream Impact] Email logs will no longer contain plaintext PINs. Supports debugging
//                     (can confirm PIN was sent) without exposing credentials to admins.
export function maskPin(pin: string | undefined): string {
  if (!pin) return '••••••';
  return '••••••';
}
