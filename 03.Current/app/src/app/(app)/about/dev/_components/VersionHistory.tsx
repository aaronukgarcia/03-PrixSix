// GUID: COMPONENT_VERSION_HISTORY-000-v03
// [Intent] Developer-facing version history component that displays a timeline of git commits
// loaded from a static JSON file. Supports filtering by major commits and show-more/less pagination.
// [Inbound Trigger] Rendered on the About > Dev page to show the project's commit history.
// [Downstream Impact] Reads from commit-history.json (static data). No writes or side effects.
// Changes to the JSON schema (Commit interface) require updates to this component.

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitCommit, Star, ChevronDown, ChevronUp } from 'lucide-react';
import commitHistory from '@/lib/commit-history.json';

// GUID: COMPONENT_VERSION_HISTORY-001-v03
// [Intent] Type definition for a single commit entry matching the structure in commit-history.json.
// [Inbound Trigger] Used to type-cast the JSON data and for rendering logic.
// [Downstream Impact] Must stay in sync with the commit-history.json schema. If the JSON fields
// change, this interface and all references in the component must be updated.
interface Commit {
  id: string;
  date: string;
  version: string;
  author: string;
  message: string;
  major: boolean;
}

// GUID: COMPONENT_VERSION_HISTORY-002-v03
// [Intent] Main exported component that renders the version history card with commit timeline,
// filter toggle (all vs major only), and expandable list with show-more/less control.
// [Inbound Trigger] Rendered by the dev section of the About page.
// [Downstream Impact] Pure display component with no side effects. Manages local UI state only
// (showAll toggle and filter selection).
export function VersionHistory() {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'major'>('all');

  const commits = commitHistory.commits as Commit[];
  const filteredCommits = filter === 'major'
    ? commits.filter(c => c.major)
    : commits;
  const displayCommits = showAll ? filteredCommits : filteredCommits.slice(0, 15);

  // GUID: COMPONENT_VERSION_HISTORY-003-v03
  // [Intent] Classifies a commit message into a display category (FEATURE, FIX, PERF, CHORE, UPDATE)
  // based on the conventional commit prefix, and returns the corresponding colour scheme.
  // [Inbound Trigger] Called for each commit during render to determine its badge styling.
  // [Downstream Impact] Visual only. Adding new commit prefixes requires extending this function.
  const getCommitType = (message: string): { type: string; color: string } => {
    if (message.startsWith('feat:') || message.startsWith('feat(')) {
      return { type: 'FEATURE', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    }
    if (message.startsWith('fix:') || message.startsWith('fix(')) {
      return { type: 'FIX', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    }
    if (message.startsWith('perf:')) {
      return { type: 'PERF', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
    }
    if (message.startsWith('chore:') || message.startsWith('docs:')) {
      return { type: 'CHORE', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' };
    }
    return { type: 'UPDATE', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
  };

  // GUID: COMPONENT_VERSION_HISTORY-004-v03
  // [Intent] Strips the conventional commit prefix (feat:, fix:, chore:, etc.) and version prefix
  // from a commit message, returning only the human-readable description.
  // [Inbound Trigger] Called for each commit during render to display a clean message.
  // [Downstream Impact] Visual only. The regex must match all prefix patterns used in getCommitType.
  const cleanMessage = (message: string): string => {
    return message
      .replace(/^(feat|fix|perf|chore|docs|refactor|test|style)(\([^)]+\))?:\s*/i, '')
      .replace(/^v\d+\.\d+\.\d+:\s*/i, '');
  };

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitCommit className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg font-medium text-zinc-100">
              Version History
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter(filter === 'all' ? 'major' : 'all')}
              className={`text-xs ${filter === 'major' ? 'bg-red-500/20 text-red-400' : 'text-zinc-400'}`}
            >
              <Star className="h-3 w-3 mr-1" />
              {filter === 'major' ? 'Major Only' : 'All Commits'}
            </Button>
            <span className="text-xs text-zinc-500 font-mono">
              {filteredCommits.length} commits
            </span>
          </div>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Last updated: {commitHistory.lastUpdated}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-zinc-800/50">
          {displayCommits.map((commit, index) => {
            const { type, color } = getCommitType(commit.message);
            return (
              <div
                key={commit.id}
                className="px-4 py-3 hover:bg-zinc-800/30 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  {/* Timeline indicator */}
                  <div className="flex flex-col items-center pt-1">
                    <div className={`w-2 h-2 rounded-full ${commit.major ? 'bg-red-500' : 'bg-zinc-600'}`} />
                    {index < displayCommits.length - 1 && (
                      <div className="w-px h-full bg-zinc-800 mt-1" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Top row: version, hash, date */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold text-zinc-100">
                        v{commit.version}
                      </span>
                      <code className="font-mono text-xs text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
                        {commit.id}
                      </code>
                      <span className="text-xs text-zinc-600">
                        {commit.date}
                      </span>
                      {commit.major && (
                        <Star className="h-3 w-3 text-red-500 fill-red-500" />
                      )}
                    </div>

                    {/* Message row */}
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${color}`}>
                        {type}
                      </Badge>
                      <span className="text-sm text-zinc-300 truncate">
                        {cleanMessage(commit.message)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Show more/less button */}
        {filteredCommits.length > 15 && (
          <div className="p-3 border-t border-zinc-800">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="w-full text-zinc-400 hover:text-zinc-200"
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show All ({filteredCommits.length - 15} more)
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
