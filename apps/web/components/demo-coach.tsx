'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import {
  readElementRect,
  spotlightPads,
  tooltipPosition,
  type SpotlightRect
} from '@/lib/demo-spotlight';

export const DEMO_TOUR_STEPS = [
  {
    target: 'user-input-section',
    title: 'Matrix script is filed',
    body: 'This is the greenscreen homage the agents will read. Press Next to run Gemini Intake — nothing is pre-played yet.'
  },
  {
    target: 'agent-pipeline',
    title: 'Gemini Intake',
    body: 'Intake posts two leads into the desk: The Matrix (franchise) and “There is no spoon” (quote). Watch the pipeline tick.'
  },
  {
    target: 'case-desk',
    title: 'Parallel Research',
    body: 'Research plans queries, hits Parallel Search/Extract, and posts tool-call chips under the agent messages.'
  },
  {
    target: 'demo-coach-findings',
    title: 'Gemini Curation',
    body: 'Curation picks primary sources and the finding cards appear. Only now is the analysis “complete” for reviewers.'
  },
  {
    target: 'demo-coach-actions',
    title: 'Your turn',
    body: 'Speak as Jordan, Alex, or Maya. Dismiss studio-owned hits or escalate anything that still needs a human call.'
  }
] as const;

type Pads = ReturnType<typeof spotlightPads>;

function currentViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Controlled coach — parent owns stepIndex so the pipeline can reveal with each press. */
export function DemoCoach({
  stepIndex,
  onStepIndexChange,
  onDismiss
}: {
  stepIndex: number;
  onStepIndexChange: (next: number) => void;
  onDismiss: () => void;
}) {
  const safeIndex = Math.min(Math.max(stepIndex, 0), DEMO_TOUR_STEPS.length - 1);
  const [pads, setPads] = useState<Pads | null>(null);
  const [cardPos, setCardPos] = useState({ top: 24, left: 24 });
  const cardRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const step = DEMO_TOUR_STEPS[safeIndex];
      const target = document.querySelector(`[data-testid="${step.target}"]`);
      if (!target) {
        setPads(null);
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const nextPads = spotlightPads(readElementRect(target), currentViewport());
      setPads(nextPads);
      const cardBox = cardRef.current?.getBoundingClientRect();
      setCardPos(
        tooltipPosition(
          nextPads.ring,
          { width: cardBox?.width ?? 360, height: cardBox?.height ?? 180 },
          currentViewport()
        )
      );
    };

    const frame = window.requestAnimationFrame(place);
    const retry = window.setTimeout(place, 280);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [safeIndex]);

  const step = DEMO_TOUR_STEPS[safeIndex];
  const isLast = safeIndex === DEMO_TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-40" data-testid="demo-coach-overlay">
      {pads ? (
        <>
          <Mask rect={pads.top} />
          <Mask rect={pads.left} />
          <Mask rect={pads.right} />
          <Mask rect={pads.bottom} />
          <div
            data-testid="demo-coach-spotlight"
            className="pointer-events-none fixed z-40 border-4 border-brand shadow-[0_0_0_4px_#050810,0_0_24px_#c6ff3d]"
            style={{
              top: pads.ring.top,
              left: pads.ring.left,
              width: pads.ring.width,
              height: pads.ring.height
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-[#050810]/80" />
      )}

      <aside
        ref={cardRef}
        data-testid="demo-coach"
        aria-live="polite"
        className="pointer-events-auto fixed z-50 w-[min(100%-1.5rem,22rem)] border-4 border-brand bg-[#050810] p-4 text-white shadow-[6px_6px_0_#c6ff3d]"
        style={{ top: cardPos.top, left: cardPos.left }}
      >
        <p className="font-pixel text-[8px] tracking-[0.18px] text-brand">
          STEP {safeIndex + 1} / {DEMO_TOUR_STEPS.length}
        </p>
        <h3 className="mt-2 font-display text-lg text-white">{step.title}</h3>
        <p className="mt-2 text-[12px] leading-5 text-[#e8edf4]">{step.body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="demo-coach-dismiss"
            onClick={onDismiss}
            className="border-2 border-white bg-transparent px-2.5 py-1.5 font-display text-[9px] text-white"
          >
            Skip tour
          </button>
          <button
            type="button"
            data-testid="demo-coach-next"
            onClick={() => {
              if (isLast) {
                onDismiss();
                return;
              }
              onStepIndexChange(safeIndex + 1);
            }}
            className="border-2 border-ink bg-brand px-2.5 py-1.5 font-display text-[9px] text-ink shadow-press"
          >
            {isLast ? 'Start working' : 'Run next stage'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Mask({ rect }: { rect: SpotlightRect }) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return (
    <div
      className="fixed z-40 bg-[#050810]/80"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    />
  );
}
