import type { DropZone } from "./model";

/**
 * Which drop zone a pointer is in, given the pane's rect.
 *
 * Not quadrants: an X through the box picks the *nearest edge*, with a rectangular centre carved out.
 * The centre is generous on purpose — for explorer drags it carries the existing behaviour (insert the
 * path into this terminal), which should be what you get unless you deliberately aim at an edge.
 *
 * `edge` is the fraction of each side that counts as an edge band (0.25 = the outer quarter).
 */
export function zoneFor(rect: DOMRect, x: number, y: number, edge = 0.25): DropZone {
  const w = rect.width || 1;
  const h = rect.height || 1;
  const fx = (x - rect.left) / w; // 0..1 across
  const fy = (y - rect.top) / h;
  if (fx >= edge && fx <= 1 - edge && fy >= edge && fy <= 1 - edge) return "center";
  // Outside the centre: whichever edge is nearest, measured in fractions so a tall pane doesn't bias
  // toward its long sides.
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  let best: DropZone = "left";
  let min = Infinity;
  for (const [k, v] of Object.entries(d)) {
    if (v < min) {
      min = v;
      best = k as DropZone;
    }
  }
  return best;
}
