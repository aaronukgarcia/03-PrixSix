// GUID: API_ADMIN_WHATSAPP_EOS-000-v01
// [Intent] Admin-triggered End-of-Season summary to WhatsApp: posts the champion + full final
//          standings to the group via the endOfSeasonSummary alert. Manual (a button) rather than
//          scheduled, since "end of season" isn't a fixed date.
// [Inbound Trigger] POST from the WhatsApp admin panel "Post End-of-Season Summary" button.
// [Downstream Impact] Enqueues one whatsapp_queue message (gated by masterEnabled && endOfSeasonSummary
//          && targetGroup) + wakes the worker. Writes an audit log.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { sendWhatsAppAlert } from '@/lib/whatsapp-alert';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap } from '@/lib/cumulative-standings';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  try {
    const verifiedUser = await verifyAuthToken(request.headers.get('Authorization'));
    if (!verifiedUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized', correlationId }, { status: 401 });
    }
    const { db, FieldValue } = await getFirebaseAdmin();
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, error: 'Admin access required', correlationId }, { status: 403 });
    }

    const { scores } = await computeRaceScores(db);
    const names = await buildTeamNamesMap(db);
    const standings = aggregateStandings(scores, names);
    if (!standings || standings.length === 0) {
      return NextResponse.json({ success: false, error: 'No standings to summarise', correlationId }, { status: 400 });
    }

    const champion = standings[0];
    const board = standings
      .map((s: any) => `${s.rank}. ${s.teamName} — ${s.totalPoints}`)
      .join('\n');
    const message =
      `🏆 *Prix Six — End of Season!*\n\n` +
      `Your champion: *${champion.teamName}* with ${champion.totalPoints} points! 🎉\n\n` +
      `*Final Standings*\n${board}\n\n` +
      `Thanks for playing — see you next season! 🏎️`;

    const res = await sendWhatsAppAlert('endOfSeasonSummary', message);
    await db.collection('audit_logs').add({
      userId: verifiedUser.uid,
      action: 'WHATSAPP_EOS_SUMMARY',
      details: { queued: res.queued, reason: res.reason || null, champion: champion.teamName },
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
    });

    if (!res.queued) {
      return NextResponse.json({ success: false, error: `Not sent: ${res.reason}`, correlationId });
    }
    return NextResponse.json({ success: true, message: `Posted end-of-season summary (champion: ${champion.teamName})`, correlationId });
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'production') console.error('[whatsapp-eos]', error?.message);
    return NextResponse.json({ success: false, error: 'Internal error', correlationId }, { status: 500 });
  }
}
