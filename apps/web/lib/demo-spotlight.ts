export type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export function readElementRect(element: Element): SpotlightRect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

const MAX_RING_VIEWPORT_RATIO = 0.42;
const MAX_RING_PX = 320;

/** Keep the lime ring readable even when the target is a tall findings column. */
export function clampSpotlightRect(rect: SpotlightRect, viewport: ViewportSize): SpotlightRect {
  const maxHeight = Math.min(viewport.height * MAX_RING_VIEWPORT_RATIO, MAX_RING_PX);
  return { ...rect, height: Math.min(rect.height, maxHeight) };
}

export function spotlightPads(
  rect: SpotlightRect,
  viewport: ViewportSize,
  gap = 8
): {
  top: SpotlightRect;
  left: SpotlightRect;
  right: SpotlightRect;
  bottom: SpotlightRect;
  ring: SpotlightRect;
} {
  const capped = clampSpotlightRect(rect, viewport);
  const top = Math.max(0, capped.top - gap);
  const left = Math.max(0, capped.left - gap);
  const right = Math.min(viewport.width, capped.left + capped.width + gap);
  const bottom = Math.min(viewport.height, capped.top + capped.height + gap);
  const height = Math.max(0, bottom - top);
  return {
    top: { top: 0, left: 0, width: viewport.width, height: top },
    left: { top, left: 0, width: left, height },
    right: { top, left: right, width: Math.max(0, viewport.width - right), height },
    bottom: {
      top: bottom,
      left: 0,
      width: viewport.width,
      height: Math.max(0, viewport.height - bottom)
    },
    ring: { top, left, width: Math.max(0, right - left), height }
  };
}

export function tooltipPosition(
  ring: SpotlightRect,
  card: { width: number; height: number },
  viewport: ViewportSize
): { top: number; left: number } {
  const spaceBelow = viewport.height - (ring.top + ring.height);
  const top =
    spaceBelow >= card.height + 16
      ? ring.top + ring.height + 12
      : Math.max(12, ring.top - card.height - 12);
  const left = Math.min(Math.max(12, ring.left), Math.max(12, viewport.width - card.width - 12));
  return { top, left };
}
