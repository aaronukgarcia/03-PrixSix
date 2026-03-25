// GUID: PAGE_DEV-000-v03
// [Intent] Developer info page — displays current build information (version, framework, backend, AI)
//          and version history. Server-rendered with static metadata.
// [Inbound Trigger] User navigates to /about/dev from the About page.
// [Downstream Impact] Reads APP_VERSION for display. Renders VersionHistory client component.

import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Code2, Terminal, FileCode2, GitBranch, Database, Cpu, Shield, Layers, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VersionHistory } from './_components/VersionHistory';
import { APP_VERSION } from '@/lib/version';
import commitHistory from '@/lib/commit-history.json';

// GUID: PAGE_DEV-001-v03
// [Intent] Next.js page metadata for SEO — sets title and description for the dev info page.
// [Inbound Trigger] Next.js framework reads this export at build/render time.
// [Downstream Impact] Sets the browser tab title and meta description for /about/dev.
export const metadata: Metadata = {
  title: 'Dev Info | Prix Six',
  description: 'Developer information and version history',
};

// GUID: PAGE_DEV-002-v03
// [Intent] Main dev page component — renders build info grid (version, framework, backend, AI),
//          version history timeline, and footer with copyright.
// [Inbound Trigger] Route navigation to /about/dev.
// [Downstream Impact] Displays APP_VERSION from version.ts. Renders VersionHistory component
//                     which loads changelog data. Links back to /about.
export default function DevPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link href="/about">
            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-200 mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to About
            </Button>
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Terminal className="h-6 w-6 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Developer Info</h1>
          </div>
          <p className="text-zinc-400">
            Build information and version history for Prix Six
          </p>
        </div>

        {/* Current Build Info */}
        <Card className="bg-zinc-900/50 border-zinc-800 mb-6">
          <CardHeader className="border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-red-500" />
              <CardTitle className="text-lg font-medium text-zinc-100">Current Build</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Version</p>
                <p className="font-mono text-lg text-zinc-100">v{APP_VERSION}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Framework</p>
                <p className="font-mono text-lg text-zinc-100">Next.js 15</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Backend</p>
                <p className="font-mono text-lg text-zinc-100">Firebase</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">AI</p>
                <p className="font-mono text-lg text-zinc-100">Claude Code</p>
              </div>
            </div>

            <div className="border-t border-zinc-800 pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Lines of Code</p>
                  <p className="font-mono text-lg text-zinc-100">~78K</p>
                  <p className="text-[10px] text-zinc-600">TypeScript + Cloud Functions</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Source Files</p>
                  <p className="font-mono text-lg text-zinc-100">290+</p>
                  <p className="text-[10px] text-zinc-600">.ts / .tsx</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Commits</p>
                  <p className="font-mono text-lg text-zinc-100">{commitHistory.commits.length}</p>
                  <p className="text-[10px] text-zinc-600">since v1.0.0</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">GUID Registry</p>
                  <p className="font-mono text-lg text-zinc-100">1,819</p>
                  <p className="text-[10px] text-zinc-600">tracked code blocks</p>
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Architecture</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { icon: Layers, label: 'React + Next.js 15', detail: 'App Router, Server Components' },
                  { icon: Database, label: 'Firestore', detail: '16 collections, real-time sync' },
                  { icon: Shield, label: 'Firebase Auth', detail: 'PIN-based login, admin roles' },
                  { icon: Cpu, label: 'PixiJS v8 WebGL', detail: 'Pit Wall track map @ 60fps' },
                  { icon: Radio, label: 'OpenF1 Integration', detail: 'Live telemetry + replay ingest' },
                  { icon: GitBranch, label: 'Cloud Functions', detail: 'Email queue, hot news, sync' },
                ].map(({ icon: Icon, label, detail }) => (
                  <div key={label} className="flex items-start gap-2 p-2 rounded bg-zinc-800/30">
                    <Icon className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-zinc-300 font-medium">{label}</p>
                      <p className="text-[10px] text-zinc-600">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Version History */}
        <VersionHistory />

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-zinc-600 font-mono">
            Prix Six &copy; {new Date().getFullYear()} &middot; Built with Claude Code
          </p>
        </div>
      </div>
    </div>
  );
}
