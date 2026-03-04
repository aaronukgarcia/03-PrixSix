
"use client";

import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ChunkErrorHandler } from '@/components/ChunkErrorHandler';
import { GlobalErrorLogger } from '@/components/GlobalErrorLogger';
import { NewVersionBanner } from '@/components/NewVersionBanner';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { useEffect } from 'react';
import { useFirebaseApp } from '@/firebase';

// GUID: APP_LAYOUT-001-v05
// @PERF_FIX (PERF-001): Performance SDK initialization removed from here (v1.58.72).
//   It is now handled in getSdks() in firebase/index.ts, which runs synchronously
//   before React renders any DOM — the only timing that reliably prevents PX-9002.
//   useEffect fires after paint; Firebase had already observed layout metrics by then.
// @FIX(v04): Added .catch() to Analytics init chain (BUG-ERR-001). Previously, if
//   isAnalyticsSupported() rejected or the Analytics SDK made a background fetch that
//   returned 403, the rejection was unhandled and propagated to GlobalErrorLogger as
//   PX-9002 noise. Analytics failures are non-critical and must never surface as errors.
// [Intent] Initialize Firebase Analytics once on app mount.
// [Inbound Trigger] Mounted once in root layout via FirebaseClientProvider context.
// [Downstream Impact] Analytics initialised for usage tracking. Performance SDK is
//                     now handled upstream in getSdks() — do not re-add it here.
function FirebaseServicesTracker() {
  const app = useFirebaseApp();
  useEffect(() => {
    isAnalyticsSupported().then(supported => {
      if (supported) {
        getAnalytics(app);
      }
    }).catch(() => {
      // Analytics unavailable or config fetch failed — non-critical, suppress silently.
      // A 403 here typically means the Firebase project's Analytics API is restricted
      // or the API key has referrer constraints. App functions normally without analytics.
    });
  }, [app]);
  return null;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>Prix Six</title>
        <meta name="description" content="The Ultimate F1 Prediction League" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <FirebaseClientProvider>
          <FirebaseServicesTracker />
          <NewVersionBanner />
          <ChunkErrorHandler />
          <GlobalErrorLogger />
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
