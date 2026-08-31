'use client';

import { Clapperboard, FolderOpen } from 'lucide-react';

export function DemoGate({
  open,
  busy,
  error,
  onWalkthrough,
  onSelfServe
}: {
  open: boolean;
  busy: boolean;
  error?: string | null;
  onWalkthrough: () => void;
  onSelfServe: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/75 p-4"
      data-testid="demo-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-gate-title"
    >
      <section className="w-full max-w-lg border-2 border-line bg-panel p-6 shadow-[6px_6px_0_#00e5ff]">
        <p className="font-pixel text-[8px] tracking-[0.16px] text-cyan-pop">THE MATRIX ON THE DESK</p>
        <h2 id="demo-gate-title" className="mt-2 font-display text-2xl text-paper [text-shadow:3px_3px_0_#aab5c4]">
          How do you want to work this desk?
        </h2>
        <p className="mt-3 text-[12px] leading-5 text-lavender-soft">
          Walk The Matrix rooftop homage — franchise plus quote, roster already assigned — or open
          a blank production and file your own pages. This choice stays on this machine until you
          hit Demo again.
        </p>
        {error ? (
          <p className="mt-4 border-2 border-accent bg-danger-bg px-3 py-2 text-sm text-accent" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-testid="demo-walkthrough"
            onClick={onWalkthrough}
            disabled={busy}
            className="border-2 border-ink bg-gradient-to-b from-brand-soft via-brand to-brand-strong px-3 py-4 text-left text-ink shadow-press transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Clapperboard className="size-4" aria-hidden />
            <span className="mt-2 block font-display text-[11px]">Walk The Matrix homage</span>
            <span className="mt-1 block text-[10.5px] leading-4">
              Opens the greenscreen homage: The Matrix plus “There is no spoon.”
            </span>
          </button>
          <button
            type="button"
            data-testid="demo-self-serve"
            onClick={onSelfServe}
            disabled={busy}
            className="border-2 border-ink bg-white px-3 py-4 text-left text-ink shadow-press transition hover:bg-exhibit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-pop disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FolderOpen className="size-4" aria-hidden />
            <span className="mt-2 block font-display text-[11px]">I&apos;ll work the desk myself</span>
            <span className="mt-1 block text-[10.5px] leading-4">
              Skip the scripted file. Create productions and paste scripts as usual.
            </span>
          </button>
        </div>
        {busy ? (
          <p className="mt-4 font-pixel text-[8px] text-lavender" data-testid="walkthrough-status">
            Filing The Matrix homage…
          </p>
        ) : null}
      </section>
    </div>
  );
}
