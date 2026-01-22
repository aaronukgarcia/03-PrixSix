import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { sendEmail } from '@/lib/email';

// Initialize Firebase Admin
if (!getApps().length) {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    initializeApp({
      credential: cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } else {
    initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

const adminDb = getFirestore();

// Generate a secure verification token
function generateVerificationToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { uid, email, teamName } = body;

    if (!uid || !email) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: uid and email' },
        { status: 400 }
      );
    }

    // Check if Graph API is configured
    if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
      return NextResponse.json(
        { success: false, error: 'Email service not configured. Graph API credentials missing.' },
        { status: 503 }
      );
    }

    // Generate verification token
    const token = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in Firestore
    await adminDb.collection('email_verification_tokens').doc(uid).set({
      token,
      email,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      used: false,
    });

    // Build verification URL
    // Use production URL if NODE_ENV is production OR if running on Google Cloud (has GOOGLE_CLOUD_PROJECT)
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
    const baseUrl = isProduction
      ? 'https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app'
      : 'http://localhost:9002';
    const verificationUrl = `${baseUrl}/verify-email?token=${token}&uid=${uid}`;

    // Send verification email via Graph API
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .cta-button { display: inline-block; background: #e10600; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Verify Your Email</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello${teamName ? ` <strong>${teamName}</strong>` : ''},</p>

      <p>Please verify your email address to complete your Prix Six account setup.</p>

      <p style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">Verify Email Address</a>
      </p>

      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; background: #e9e9e9; padding: 10px; border-radius: 4px; font-size: 12px;">
        ${verificationUrl}
      </p>

      <div class="security-note">
        <strong>Note:</strong> This link will expire in 24 hours. If you did not create a Prix Six account, please ignore this email.
      </div>
    </div>
    <div class="footer">
      <p>Prix Six - F1 Prediction League</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    const emailResult = await sendEmail({
      toEmail: email,
      subject: 'Verify your Prix Six email address',
      htmlContent,
    });

    if (emailResult.success) {
      // Log the verification email sent
      await adminDb.collection('audit_logs').add({
        userId: uid,
        action: 'verification_email_sent_graph',
        data: { email, emailGuid: emailResult.emailGuid },
        timestamp: Timestamp.now(),
      });

      return NextResponse.json({
        success: true,
        message: 'Verification email sent',
        emailGuid: emailResult.emailGuid,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: emailResult.error || 'Failed to send verification email',
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error sending verification email:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
