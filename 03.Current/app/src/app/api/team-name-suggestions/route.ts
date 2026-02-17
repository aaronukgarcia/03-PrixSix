// GUID: API_TEAM_NAME_SUGGESTIONS-000-v01
// [Intent] Public GET endpoint that returns 50 shuffled F1-themed team name suggestions,
//          filtered against existing team names (both primary and secondary) in Firestore.
// [Inbound Trigger] Fetched by signup and complete-profile pages on mount.
// [Downstream Impact] Powers the dynamic team name suggestion UI. No auth required since
//                     the signup page is public.

import { NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { generateSuggestions } from '@/lib/team-name-suggestions';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

// GUID: API_TEAM_NAME_SUGGESTIONS-001-v01
// [Intent] GET handler that fetches all existing team names from Firestore and returns
//          50 filtered, shuffled suggestions from the curated pool.
// [Inbound Trigger] GET /api/team-name-suggestions
// [Downstream Impact] Returns { suggestions: string[] }. On error, returns empty array
//                     so the client can fall back gracefully.
export async function GET() {
  const correlationId = generateCorrelationId();

  try {
    const { db } = await getFirebaseAdmin();

    const allUsersSnapshot = await db.collection('users').get();
    const existingNames: string[] = [];

    allUsersSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.teamName) existingNames.push(data.teamName);
      if (data.secondaryTeamName) existingNames.push(data.secondaryTeamName);
    });

    const suggestions = generateSuggestions(existingNames, 50);

    return NextResponse.json({ suggestions, correlationId });
  } catch (error) {
    // @GOLDEN_RULE_1: Proper error logging with 4-pillar pattern (Phase 4 compliance).
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.DATABASE_READ_FAILED, {
      correlationId,
      context: { route: '/api/team-name-suggestions', action: 'GET' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    // Return empty suggestions array for graceful degradation, but include error details for debugging
    return NextResponse.json({
      suggestions: [],
      error: traced.definition.message,
      errorCode: traced.definition.code,
      correlationId: traced.correlationId,
    });
  }
}
