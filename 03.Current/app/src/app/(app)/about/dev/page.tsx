import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Code2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VersionHistory } from './_components/VersionHistory';
import { APP_VERSION } from '@/lib/version';

export const metadata: Metadata = {
  title: 'Dev Info | Prix Six',
  description: 'Developer information and version history',
};

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
          <CardContent className="pt-4">
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
                <p className="font-mono text-lg text-zinc-100">Vertex AI</p>
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
