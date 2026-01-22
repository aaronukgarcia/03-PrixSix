import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';

// Initialize Firebase Admin if not already done
let app: App;
if (!getApps().length) {
  // In production (Firebase App Hosting), use default credentials
  // Locally, use service account from env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = initializeApp({
      credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'studio-6033436327-281b1',
    });
  } else {
    app = initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'studio-6033436327-281b1',
    });
  }
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

// Force dynamic
export const dynamic = 'force-dynamic';

interface ClientErrorRequest {
  correlationId: string;
  errorCode?: string;
  error: string;
  stack?: string;
  digest?: string;
  context?: {
    route?: string;
    action?: string;
    userAgent?: string;
    [key: string]: any;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ClientErrorRequest = await request.json();

    // Basic validation
    if (!body.correlationId || !body.error) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Rate limiting - simple check based on IP (optional enhancement)
    // For now, just log it

    // Log to error_logs collection
    await db.collection('error_logs').add({
      correlationId: body.correlationId,
      errorCode: body.errorCode || 'PX-9001',
      error: body.error,
      stack: body.stack || null,
      digest: body.digest || null,
      context: {
        ...body.context,
        source: 'client',
        additionalInfo: {
          errorCode: body.errorCode || 'PX-9001',
          errorType: 'ClientSideError',
        },
      },
      timestamp: new Date(),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Log Client Error API]', error);
    // Don't fail - client is already in error state
    return NextResponse.json(
      { success: false, error: 'Failed to log error' },
      { status: 500 }
    );
  }
}
