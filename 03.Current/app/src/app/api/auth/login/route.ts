import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// Maximum login attempts before lockout
const MAX_LOGIN_ATTEMPTS = 5;

// Lockout duration in milliseconds (30 minutes)
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

interface LoginRequest {
  email: string;
  pin: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const data: LoginRequest = await request.json();
    const { email, pin } = data;

    // Validate required fields
    if (!email || !pin) {
      await logError({
        correlationId,
        error: new Error('Email and PIN are required'),
        context: {
          route: '/api/auth/login',
          action: 'validation',
          requestData: { email: email || 'missing' },
        },
      });
      return NextResponse.json(
        { success: false, error: 'Email and PIN are required', correlationId },
        { status: 400 }
      );
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // Find user by email in Firestore
    const usersQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // SECURITY: Check if account exists and lockout status BEFORE attempting auth
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Check if account is locked
      const badAttempts = userData.badLoginAttempts || 0;
      const lastAttemptTime = userData.lastFailedLoginAt?.toMillis?.() || 0;
      const timeSinceLastAttempt = Date.now() - lastAttemptTime;

      // If locked and lockout period hasn't expired
      if (badAttempts >= MAX_LOGIN_ATTEMPTS && timeSinceLastAttempt < LOCKOUT_DURATION_MS) {
        const remainingMinutes = Math.ceil((LOCKOUT_DURATION_MS - timeSinceLastAttempt) / 60000);

        // Log the locked out attempt
        await db.collection('audit_logs').add({
          userId,
          action: 'login_attempt_locked',
          details: {
            email: normalizedEmail,
            badAttempts,
            remainingMinutes,
          },
          timestamp: FieldValue.serverTimestamp(),
        });

        return NextResponse.json(
          {
            success: false,
            error: `Account is locked due to too many failed attempts. Try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            locked: true,
            correlationId,
          },
          { status: 429 }
        );
      }

      // If lockout period has expired, reset the counter
      if (badAttempts >= MAX_LOGIN_ATTEMPTS && timeSinceLastAttempt >= LOCKOUT_DURATION_MS) {
        await userDoc.ref.update({
          badLoginAttempts: 0,
          lastFailedLoginAt: null,
        });
      }
    }

    // Attempt to verify credentials using Firebase Auth
    // First, get the user by email
    let firebaseUserRecord;
    try {
      firebaseUserRecord = await auth.getUserByEmail(normalizedEmail);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Don't reveal if user exists or not - but log for debugging
        await logError({
          correlationId,
          error: new Error('Login attempt for non-existent user'),
          context: {
            route: '/api/auth/login',
            action: 'user_lookup',
            requestData: { email: normalizedEmail },
          },
        });
        return NextResponse.json(
          { success: false, error: 'Invalid email or PIN', correlationId },
          { status: 401 }
        );
      }
      throw error;
    }

    // Verify the PIN by attempting to sign in with Firebase Auth REST API
    // Since Admin SDK can't verify passwords, we use the Firebase Auth REST API
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    if (!firebaseApiKey) {
      console.error('[Auth] Firebase API key not configured');
      await logError({
        correlationId,
        error: new Error('NEXT_PUBLIC_FIREBASE_API_KEY environment variable is not configured'),
        context: {
          route: '/api/auth/login',
          action: 'config_check',
          requestData: { email: normalizedEmail },
        },
      });
      return NextResponse.json(
        { success: false, error: 'Server configuration error', correlationId },
        { status: 500 }
      );
    }

    // Use Firebase Auth REST API to verify password
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password: pin,
          returnSecureToken: true,
        }),
      }
    );

    const authResult = await authResponse.json();

    if (!authResponse.ok || authResult.error) {
      // Invalid credentials - increment bad login attempts
      if (!usersQuery.empty) {
        const userDoc = usersQuery.docs[0];
        const userId = userDoc.id;
        const currentAttempts = userDoc.data().badLoginAttempts || 0;

        await userDoc.ref.update({
          badLoginAttempts: currentAttempts + 1,
          lastFailedLoginAt: FieldValue.serverTimestamp(),
        });

        // Log failed attempt
        await db.collection('audit_logs').add({
          userId,
          action: 'login_failed',
          details: {
            email: normalizedEmail,
            attempt: currentAttempts + 1,
            reason: 'invalid_pin',
          },
          timestamp: FieldValue.serverTimestamp(),
        });

        // Check if this attempt triggers lockout
        if (currentAttempts + 1 >= MAX_LOGIN_ATTEMPTS) {
          return NextResponse.json(
            {
              success: false,
              error: 'Account has been locked due to too many failed attempts. Try again in 30 minutes.',
              locked: true,
              correlationId,
            },
            { status: 429 }
          );
        }
      }

      return NextResponse.json(
        { success: false, error: 'Invalid email or PIN', correlationId },
        { status: 401 }
      );
    }

    // Success! Generate a custom token for the client
    const customToken = await auth.createCustomToken(firebaseUserRecord.uid);

    // Reset bad login attempts on successful login
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const userId = userDoc.id;

      await userDoc.ref.update({
        badLoginAttempts: 0,
        lastFailedLoginAt: null,
      });

      // Log successful login
      await db.collection('audit_logs').add({
        userId,
        action: 'login_success',
        details: {
          email: normalizedEmail,
          method: 'server_verified',
        },
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      success: true,
      customToken,
      uid: firebaseUserRecord.uid,
    });

  } catch (error: any) {
    console.error('[Login Error]', error);

    let requestData: any = {};
    try {
      requestData = await request.clone().json();
      delete requestData.pin; // Don't log the PIN
    } catch {}

    // Try to log error, but don't fail if logging fails
    try {
      await logError({
        correlationId,
        error,
        context: {
          route: '/api/auth/login',
          action: 'POST',
          requestData: { email: requestData.email },
          userAgent: request.headers.get('user-agent') || undefined,
        },
      });
    } catch (logErr) {
      console.error('[Login Error - Logging failed]', logErr);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred during login',
        correlationId,
        // Include error type for debugging (safe - no sensitive data)
        errorType: error.code || error.name || 'UnknownError',
        errorMessage: error.message?.substring(0, 200) || 'No message',
      },
      { status: 500 }
    );
  }
}
