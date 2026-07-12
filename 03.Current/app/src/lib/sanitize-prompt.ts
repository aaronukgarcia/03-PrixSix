// GUID: LIB_SANITIZE_PROMPT-000-v01
// [Intent] Single source of truth for sanitising strings before they are interpolated into an AI
//          (Gemini/Vertex) prompt. Strips control characters, newlines, carriage returns and null
//          bytes, keeps only a safe allowlist, and truncates to maxLen. Neutralises prompt-injection
//          where crafted external text (RSS headlines, third-party API strings, user fields) could
//          otherwise smuggle instructions into the prompt.
// [Inbound Trigger] Called by api/ai/analysis (raceName/circuit/driver/team) and by
//                   ai/flows/hot-news-feed (Autosport RSS headlines + Jolpica standings strings).
// [Downstream Impact] Output is safe for direct interpolation into a template literal sent to Gemini.
//                     Extracted from api/ai/analysis/route.ts so both callers share ONE implementation
//                     (Golden Rule #3 — no duplicated security logic).

// GUID: LIB_SANITIZE_PROMPT-001-v01
// [Intent] Strip control chars + anything outside the safe allowlist, then truncate.
// [Inbound Trigger] Per external/user-supplied field before prompt interpolation.
// [Downstream Impact] Non-string input returns '' (fail-safe). Newlines/instructions cannot survive.
export function sanitizeForPrompt(input: string, maxLen = 100): string {
  if (typeof input !== 'string') return '';
  const stripped = input
    .replace(/[\x00-\x1F\x7F]/g, '')          // remove all ASCII control characters (0-31, 127)
    .replace(/[^a-zA-Z0-9 \-'.,()&]/g, '');   // strip anything outside the safe allowlist
  return stripped.substring(0, maxLen);
}
