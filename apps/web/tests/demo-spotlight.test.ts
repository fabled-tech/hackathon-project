import { describe, expect, it } from 'vitest';
import { spotlightPads, tooltipPosition } from '../lib/demo-spotlight';

describe('demo spotlight geometry', () => {
  it('cuts a hole around the target and leaves a lime-ring box', () => {
    const pads = spotlightPads(
      { top: 100, left: 80, width: 200, height: 40 },
      { width: 1000, height: 800 },
      8
    );

    expect(pads.ring).toEqual({ top: 92, left: 72, width: 216, height: 56 });
    expect(pads.top.height).toBe(92);
    expect(pads.left.width).toBe(72);
    expect(pads.right.left).toBe(288);
    expect(pads.bottom.top).toBe(148);
  });

  it('parks the tooltip under the ring when there is room', () => {
    expect(
      tooltipPosition(
        { top: 80, left: 40, width: 200, height: 50 },
        { width: 320, height: 160 },
        { width: 1200, height: 900 }
      )
    ).toEqual({ top: 142, left: 40 });
  });

  it('flips the tooltip above the ring near the bottom of the viewport', () => {
    const position = tooltipPosition(
      { top: 700, left: 40, width: 200, height: 80 },
      { width: 320, height: 160 },
      { width: 1200, height: 800 }
    );
    expect(position.top).toBeLessThan(700);
  });
});
