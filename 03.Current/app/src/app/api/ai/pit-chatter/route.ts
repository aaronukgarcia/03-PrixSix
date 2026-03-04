// GUID: API_AI_PIT_CHATTER-000-v01
// [Intent] AI-powered pit-side chatter generator for the PubChat live timing page.
//          Accepts a distilled snapshot of the current session leaderboard and generates
//          short, punchy commentary in the voice of one of two paddock personas:
//          Jack Sparrow (Jack Whitehall — cheeky/irreverent) or Rowan Hornblower
//          (Bernie Collins — strategic/dry). Persona is chosen randomly per request.
// [Inbound Trigger] POST from LiveTimingClient "Generate Chatter" button.
// [Downstream Impact] Calls Vertex AI (Gemini) via Genkit. Rate-limited to 5 req/hour
//                     per user. No data persisted beyond error_logs. Ephemeral output.

import { NextRequest, NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

// GUID: API_AI_PIT_CHATTER-001-v01
// [Intent] Shape of each driver entry sent from the client.
interface ChatterDriver {
  position: number;
  name: string;      // surname
  team: string;
  time: string;      // formatted: "1:31.992"
  tyre?: string;     // "SOFT" | "MEDIUM" | "HARD" | null
  laps: number;
}

// GUID: API_AI_PIT_CHATTER-002-v01
// [Intent] Full request body shape.
interface PitChatterRequest {
  session: {
    name: string;     // e.g. "Day 3"
    meeting: string;  // e.g. "Pre-Season Testing"
    location: string; // e.g. "Bahrain"
  };
  drivers: ChatterDriver[];
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_DOC = 'pit-chatter';

const PERSONAS = [
  {
    name: 'Jack Sparrow',
    title: 'The Paddock Joker',
    style: `Write in the style of Jack Whitehall — cheeky British wit, playful irreverence, comic timing. React to the leaderboard like a surprised fan who just walked pit lane. Use punchy one-liners. Mock bold surprises with theatrical disbelief. Warm, funny, never cruel. Short sentences. British slang welcome.`,
  },
  {
    name: 'Rowan Hornblower',
    title: 'The Strategy Desk',
    style: `Write in the style of Bernie Collins — calm F1 strategist, understated and precise. Notice the data: gap to P1, tyre choices, laps completed. Draw tactical conclusions in dry, measured language. Mild scepticism about pace that won't last. A single wry observation at the end. Never gushing.`,
  },
];

// GUID: API_AI_PIT_CHATTER-003-v01
// [Intent] Strip everything except safe display characters before interpolating
//          Firestore strings into the AI prompt. Prevents prompt injection.
function sanitize(input: string, maxLen = 60): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[^a-zA-Z0-9 \-'.,()&]/g, '')
    .substring(0, maxLen);
}

// GUID: API_AI_PIT_CHATTER-004-v01
// [Intent] Per-user rate limiter using Firestore sliding window.
//          Separate document from the analysis rate limiter (RATE_LIMIT_DOC = 'pit-chatter').
//          Returns { allowed, count, resetAt }.
async function checkRateLimit(userId: string): Promise<{ allowed: boolean; resetAt: Date }> {
  const { db, FieldValue, Timestamp } = await getFirebaseAdmin();
  const ref = db.collection('users').doc(userId).collection('aiRateLimit').doc(RATE_LIMIT_DOC);

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const now = Date.now();

    if (!doc.exists) {
      const resetAt = new Date(now + RATE_LIMIT_WINDOW_MS);
      tx.set(ref, { count: 1, windowStart: Timestamp.fromMillis(now), resetAt: Timestamp.fromDate(resetAt) });
      return { allowed: true, resetAt };
    }

    const d = doc.data()!;
    const windowStart: number = d.windowStart?.toMillis?.() ?? 0;
    const count: number = d.count ?? 0;

    if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
      const resetAt = new Date(now + RATE_LIMIT_WINDOW_MS);
      tx.set(ref, { count: 1, windowStart: Timestamp.fromMillis(now), resetAt: Timestamp.fromDate(resetAt) });
      return { allowed: true, resetAt };
    }

    if (count >= RATE_LIMIT_MAX) {
      const resetAt: Date = d.resetAt?.toDate?.() ?? new Date(windowStart + RATE_LIMIT_WINDOW_MS);
      return { allowed: false, resetAt };
    }

    const resetAt: Date = d.resetAt?.toDate?.() ?? new Date(windowStart + RATE_LIMIT_WINDOW_MS);
    tx.update(ref, { count: FieldValue.increment(1) });
    return { allowed: true, resetAt };
  });
}

// GUID: API_AI_PIT_CHATTER-005-v01
// [Intent] Build the Gemini prompt from session + leaderboard data and persona config.
//          All user-sourced strings (driver names, team names, location) are sanitized.
function buildPrompt(req: PitChatterRequest, persona: typeof PERSONAS[0]): string {
  const session = `${sanitize(req.session.meeting)} — ${sanitize(req.session.name)} at ${sanitize(req.session.location)}`;

  const board = req.drivers
    .slice(0, 10)
    .map(d => {
      const tyre = d.tyre ? ` [${sanitize(d.tyre, 15)}]` : '';
      return `P${d.position}. ${sanitize(d.name)} (${sanitize(d.team)}) — ${sanitize(d.time, 15)}${tyre} — ${d.laps} laps`;
    })
    .join('\n');

  return `You are ${persona.name} — ${persona.title} — at the ${session}.

The live timing board right now:

${board}

${persona.style}

Write 120–160 words of pit-side chatter reacting to this exact leaderboard. Reference specific drivers, times, and tyres. No generic F1 waffle. Begin immediately — no intro, no sign-off.`;
}

// GUID: API_AI_PIT_CHATTER-006-v01
// [Intent] POST handler — auth, rate limit, prompt build, AI call, response.
// [Inbound Trigger] POST /api/ai/pit-chatter from LiveTimingClient.
// [Downstream Impact] Calls Vertex AI (cost per request). Returns chatter text + persona.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const verifiedUser = await verifyAuthToken(request.headers.get('Authorization'));
    if (!verifiedUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized', correlationId }, { status: 401 });
    }

    // Rate limit
    let rateLimit: { allowed: boolean; resetAt: Date };
    try {
      rateLimit = await checkRateLimit(verifiedUser.uid);
    } catch {
      rateLimit = { allowed: true, resetAt: new Date() };
    }

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AI_RATE_LIMITED.message,
          errorCode: ERRORS.AI_RATE_LIMITED.code,
          correlationId,
          retryAfter: rateLimit.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)) },
        }
      );
    }

    const body: PitChatterRequest = await request.json();

    if (!body.session || !Array.isArray(body.drivers) || body.drivers.length === 0) {
      return NextResponse.json({ success: false, error: 'No timing data provided', correlationId }, { status: 400 });
    }

    // Randomly pick a persona each request
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    const prompt = buildPrompt(body, persona);

    let chatter: string;
    try {
      const result = await ai.generate({
        prompt,
        config: { maxOutputTokens: 300, temperature: 0.85 },
      });
      chatter = result.text.trim();
    } catch (aiError: any) {
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.AI_GENERATION_FAILED, {
        correlationId,
        context: { route: '/api/ai/pit-chatter', action: 'ai.generate' },
        cause: aiError instanceof Error ? aiError : undefined,
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: ERRORS.AI_GENERATION_FAILED.message, errorCode: ERRORS.AI_GENERATION_FAILED.code, correlationId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      chatter,
      persona: persona.name,
      personaTitle: persona.title,
    });

  } catch (error: any) {
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.AI_GENERATION_FAILED, {
      correlationId,
      context: { route: '/api/ai/pit-chatter', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, db);
    return NextResponse.json(
      { success: false, error: traced.definition.message, errorCode: traced.definition.code, correlationId: traced.correlationId },
      { status: 500 }
    );
  }
}
