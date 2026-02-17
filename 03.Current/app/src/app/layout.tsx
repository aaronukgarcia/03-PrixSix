
"use client";

import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ChunkErrorHandler } from '@/components/ChunkErrorHandler';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { getPerformance } from 'firebase/performance';
import { useEffect } from 'react';
import { useFirebaseApp } from '@/firebase';

function FirebaseServicesTracker() {
  const app = useFirebaseApp();
  useEffect(() => {
    // Initialize Analytics
    isAnalyticsSupported().then(supported => {
      if (supported) {
        getAnalytics(app);
      }
    });
    // Initialize Performance with error handling
    // Firebase Performance can throw errors when attribute values (like Tailwind class names) exceed 100 chars
    try {
      const perf = getPerformance(app);
      // Disable automatic data collection for DOM interactions to avoid class name issues
      perf.dataCollectionEnabled = true;
      perf.instrumentationEnabled = false; // Disable auto-instrumentation (captures class names)
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
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
