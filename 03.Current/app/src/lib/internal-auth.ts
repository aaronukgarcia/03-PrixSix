// GUID: LIB_INTERNAL_AUTH-000-v01
// [Intent] Shared timing-safe authentication for INTERNAL server-to-server API calls (one Next.js
//          route calling another over HTTP, e.g. signup → send-verification-email). Several
//          transactional email routes must stay callable by our own server flows but were previously
//          reachable UNAUTHENTICATED by any anonymous internet caller (cyber.md H-1: brand-spoof mail,
//          phishing, Graph-quota exhaustion). This gates them with the already-provisioned CRON_SECRET
//          carried in an X-Internal-Secret header — no new secret to provision, server-side only.
// [Inbound Trigger] isInternalRequest() called at the top of internally-triggered routes;
//                   internalAuthHeaders() called by the server-side caller when it fetch()es them.
// [Downstream Impact] Anonymous callers lacking the secret are rejected (401). Reuses the exact
//                     timing-safe comparison used by the cron routes (crypto.timingSafeEqual).

import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

// GUID: LIB_INTERNAL_AUTH-001-v01
// [Intent] Resolve the shared internal secret. Reuses CRON_SECRET (already set via
//          `firebase apphosting:secrets:set CRON_SECRET`) and strips a possible BOM that Secret
//          Manager can prepend on Windows-created secrets — mirrors the cron routes exactly.
// [Inbound Trigger] Read by isInternalRequest() and internalAuthHeaders().
// [Downstream Impact] Empty/unset secret means isInternalRequest() always returns false (fail-closed).
function internalSecret(): string {
  return (process.env.CRON_SECRET ?? '').replace(/^﻿/, '');
}

// GUID: LIB_INTERNAL_AUTH-002-v01
// [Intent] Return true only if the request carries the correct X-Internal-Secret header, compared
//          in constant time to defeat token-oracle timing attacks.
// [Inbound Trigger] Called at the top of routes that accept internal server-to-server calls.
// [Downstream Impact] Callers reject with 401 when this returns false. Never throws.
export function isInternalRequest(request: NextRequest): boolean {
  const secret = internalSecret();
  if (!secret) return false;
  const header = request.headers.get('x-internal-secret');
  if (!header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// GUID: LIB_INTERNAL_AUTH-003-v01
// [Intent] Build the header object a server-side caller spreads into its fetch() when invoking an
//          internal email route. Returns an empty object (not the secret) if CRON_SECRET is unset so
//          a misconfigured environment degrades to a 401 at the callee rather than leaking anything.
// [Inbound Trigger] Called server-side by signup/route.ts and complete-oauth-profile/route.ts.
// [Downstream Impact] Adds the X-Internal-Secret header the callee validates via isInternalRequest().
export function internalAuthHeaders(): Record<string, string> {
  const secret = internalSecret();
  return secret ? { 'X-Internal-Secret': secret } : {};
}
