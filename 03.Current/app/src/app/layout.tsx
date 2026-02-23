
"use client";

import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ChunkErrorHandler } from '@/components/ChunkErrorHandler';
import { GlobalErrorLogger } from '@/components/GlobalErrorLogger';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { initializePerformance } from 'firebase/performance';
import { useEffect } from 'react';
import { useFirebaseApp } from '@/firebase';

// GUID: APP_LAYOUT-001-v02
// [Intent] Initialize Firebase Analytics and Performance SDK once on app mount.
//          Performance uses initializePerformance (not getPerformance) so that
//          instrumentationEnabled: false is set synchronously at SDK init time,
//          before the SDK starts observing DOM elements. This prevents PERF-001:
//          Firebase Performance auto-instrumentation passing Tailwind CSS class
//          strings (which contain [ ] & > : / chars) to putAttribute(), causing
//          PX-9002 FirebaseError on every page load. (PERF-001 fix, v1.58.68)
// [Inbound Trigger] Mounted once in root layout via FirebaseClientProvider context.
// [Downstream Impact] Analytics initialised for usage tracking. Performance SDK
//                     initialised with auto-instrumentation disabled — manual
//                     traces still work, automatic Web Vitals capture is off.
function FirebaseServicesTracker() {
  const app = useFirebaseApp();
  useEffect(() => {
    // Initialize Analytics
    isAnalyticsSupported().then(supported => {
      if (supported) {
        getAnalytics(app);
      }
    });
    // PERF-001 fix: Use initializePerformance with instrumentationEnabled: false
    // passed at init time so the SDK never starts auto-instrumenting DOM elements.
    // getPerformance() + setting the flag after init was a race — the SDK had
    // already captured element classNames before our useEffect ran. (v1.58.68)
    try {
      initializePerformance(app, { instrumentationEnabled: false });
    } catch (error) {
      console.warn('Firebase Performance initialization skipped:', error);
    }
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
          <ChunkErrorHandler />
          <GlobalErrorLogger />
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
