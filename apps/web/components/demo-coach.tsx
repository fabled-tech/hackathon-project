'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  readElementRect,
  spotlightPads,
  tooltipPosition,
  type SpotlightRect
} from '@/lib/demo-spotlight';

export const DEMO_TOUR_STEPS = [
  {
    target: 'demo-coach-roster',
    title: 'Who sits on this file',
    body: 'Jordan (clearance), Alex (production), and Maya (legal) are already in this thread. You will speak as one of them.'
  },
  {
    target: 'demo-coach-stakeholders',
    title: 'Agents already moved',
    body: 'Intake found The Matrix and “There is no spoon.” Research pulled the owners and posted the Parallel work here — one conversation, not a chatbot.'
  },
  {
    target: 'demo-coach-findings',
    title: 'Two leads to decide',
    body: 'Franchise homage on the left of this column, distinctive quote under it. This is the work, not the judge log.'
  },
  {
    target: 'demo-coach-composer',
    title: 'Reply as a human',
    body: 'Pick Jordan, Alex, or Maya and post in the same thread. Dismiss and escalate land here too.'
  },
  {
    target: 'demo-coach-actions',
    title: 'Dismiss or escalate',
    body: 'Studio-owned hits can be dismissed. Escalate anything that still needs a human call. Both post into this desk.'
  }
] as const;

type Pads = ReturnType<typeof spotlightPads>;

function currentViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function DemoCoach({
  open,
  onDismiss
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [pads, setPads] = useState<Pads | null>(null);
  const [cardPos, setCardPos] = useState({ top: 24, left: 24 });
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setPads(null);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const step = DEMO_TOUR_STEPS[stepIndex];
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
  }, [open, stepIndex]);

  if (!open) return null;

  const step = DEMO_TOUR_STEPS[stepIndex];
  const isLast = stepIndex === DEMO_TOUR_STEPS.length - 1;

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
          STEP {stepIndex + 1} / {DEMO_TOUR_STEPS.length}
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
              setStepIndex((current) => current + 1);
            }}
            className="border-2 border-ink bg-brand px-2.5 py-1.5 font-display text-[9px] text-ink shadow-press"
          >
            {isLast ? 'Start working' : 'Next step'}
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
