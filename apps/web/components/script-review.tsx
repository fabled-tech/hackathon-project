'use client';

import { CheckCircle2, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

function Pill({
  children,
  tone = 'brand'
}: {
  children: ReactNode;
  tone?: 'brand' | 'muted' | 'warn';
}) {
  const toneClass =
    tone === 'warn'
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
      : tone === 'muted'
        ? 'border-slate-500/30 bg-slate-500/10 text-slate-200'
        : 'border-brand/30 bg-brand-soft text-brand';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas/70 p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{note}</p>
    </div>
  );
}

export function ScriptReview({ demoMode = false }: { demoMode?: boolean }) {
  return (
    <main className="min-h-screen px-6 py-8 text-ink sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line/80 pb-6">
          <div className="max-w-2xl">
            <Pill>
              <Sparkles className="size-3.5" aria-hidden />
              RightsRadar
            </Pill>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
              A polished hackathon demo for rights clearance research
            </h1>
            <p className="mt-4 text-base leading-7 text-muted">
              Review scripts, surface potential rights issues, and keep the final decision with a
              human reviewer. This build is packaged for a public Vercel URL.
            </p>
          </div>
          <div className="rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand">
            {demoMode ? 'Demo mode active' : 'Live mode'}
          </div>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Scripts reviewed"
            value={demoMode ? '12' : '0'}
            note="A short sample set for judging and walkthroughs."
          />
          <MetricCard
            label="Leads escalated"
            value={demoMode ? '4' : '0'}
            note="Flags a human should inspect before clearance."
          />
          <MetricCard
            label="Assets tracked"
            value={demoMode ? '7' : '0'}
            note="Supports notes and attachments in the same flow."
          />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
          <article className="rounded-3xl border border-line bg-panel p-6 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">Demo flow</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                  Sample script review
                </h2>
              </div>
              <Pill tone="warn">
                <ShieldCheck className="size-3.5" aria-hidden />
                Human review required
              </Pill>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-line bg-canvas p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-muted">Script excerpt</p>
                <p className="mt-3 font-mono text-sm leading-6 text-ink-soft">
                  MARA skates through the rain, kicks a Nimbus Soda can into her palm, and says,
                  &ldquo;Time keeps the reel turning.&rdquo;
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">
                    Flagged items
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      Nimbus Soda reference
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      Quoted line with possible rights trace
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">
                    Reviewer actions
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Pill tone="muted">Dismiss</Pill>
                    <Pill tone="brand">Escalate</Pill>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <aside className="rounded-3xl border border-line bg-panel p-6 shadow-card">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">Deployment</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">Vercel-ready setup</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Ship the web app on Vercel as the judging URL. Keep the API behind a separate hosted
              service or run the app in demo mode for a crisp single-link presentation.
            </p>

            <div className="mt-5 space-y-3 text-sm">
              <div className="rounded-2xl border border-line bg-canvas p-4">
                <p className="font-semibold text-ink">1. Configure environment variables</p>
                <p className="mt-1 text-muted">Set the public API URL or lock the app to demo mode.</p>
              </div>
              <div className="rounded-2xl border border-line bg-canvas p-4">
                <p className="font-semibold text-ink">2. Deploy to Vercel</p>
                <p className="mt-1 text-muted">Use the public link as the competition entry point.</p>
              </div>
              <div className="rounded-2xl border border-line bg-canvas p-4">
                <p className="font-semibold text-ink">3. Walk through the polished flow</p>
                <p className="mt-1 text-muted">Focus on the script review, findings, and reviewer actions.</p>
              </div>
            </div>

            <a
              href="https://vercel.com"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand underline-offset-4 hover:underline"
            >
              Open Vercel
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </aside>
        </section>
      </div>
    </main>
  );
}
