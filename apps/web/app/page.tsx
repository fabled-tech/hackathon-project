'use client';

import { ProductionMonitor } from '@/components/production-monitor';
import { ScriptReview } from '@/components/script-review';
import { Clapperboard, Radar } from 'lucide-react';
import { useState } from 'react';

type Workspace = 'review' | 'production';

export default function HomePage() {
  const [workspace, setWorkspace] = useState<Workspace>('review');

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Radar className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">RightsRadar</p>
              <p className="text-xs text-muted">Research assistance only — not legal advice</p>
            </div>
          </div>
          <nav className="flex rounded-xl border border-line bg-panel p-1" aria-label="Workspace">
            <button
              type="button"
              onClick={() => setWorkspace('review')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                workspace === 'review'
                  ? 'bg-brand text-canvas shadow-card'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Radar className="size-4" aria-hidden />
              Script Review
            </button>
            <button
              type="button"
              onClick={() => setWorkspace('production')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                workspace === 'production'
                  ? 'bg-brand text-canvas shadow-card'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Clapperboard className="size-4" aria-hidden />
              Production Monitor
            </button>
          </nav>
        </div>
      </header>
      {workspace === 'review' ? <ScriptReview embedded /> : <ProductionMonitor embedded />}
    </div>
  );
}
