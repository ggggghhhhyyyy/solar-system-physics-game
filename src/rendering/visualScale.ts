import type { Body, UiMode } from '../physics/types';

/** Minimum on-screen radius so planets/moons stay clickable. VISUAL APPROXIMATION. */
export function minReadablePx(b: Body): number {
  if (b.isBlackHole || b.isStar) return 7;
  if (b.mass > 1e-5) return 4.5;
  if (b.key) return 3.5;
  if (b.userLaunched) return 3;
  return 2.2;
}

/**
 * Dynamic visual scale:
 *   screenRadius = max(physicalProjected, minimumReadable)
 * SCIENCE uses physicalRadius; GAME uses renderRadius (legacy exaggerated size).
 * Physics never sees this number.
 */
export function screenRadiusPx(b: Body, zoom: number, mode: UiMode): number {
  const physPx = b.physicalRadius * zoom;
  const renderPx = (b.renderRadius ?? b.physicalRadius) * zoom;
  const floor = minReadablePx(b);
  if (mode === 'science') return Math.max(physPx, floor);
  return Math.max(renderPx, floor);
}

export function screenRadiusAU(b: Body, zoom: number, mode: UiMode): number {
  return screenRadiusPx(b, zoom, mode) / Math.max(zoom, 1e-12);
}
