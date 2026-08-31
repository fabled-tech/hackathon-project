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
  const top = Math.max(0, rect.top - gap);
  const left = Math.max(0, rect.left - gap);
  const right = Math.min(viewport.width, rect.left + rect.width + gap);
  const bottom = Math.min(viewport.height, rect.top + rect.height + gap);
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
