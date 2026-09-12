/**
 * Canonical body classification. PHYSICAL MODEL.
 *
 * Every system-level massive-body quantity MUST use these helpers.
 * Do not re-implement "has mass" / "is a tracer" checks in gravity,
 * barycentre, conservation, primaries, or encounter scans.
 */

export type GravityModeLike = 'massive' | 'test-particle' | undefined;

export interface SemanticBody {
  gravityMode?: GravityModeLike;
  mass: number;
}

/**
 * A body that sources gravity and contributes to system COM / E / P / L.
 * Undefined gravityMode defaults to massive (authoring form).
 */
export function isMassiveBody(body: SemanticBody): boolean {
  const mode = body.gravityMode ?? 'massive';
  return mode === 'massive' && body.mass > 0;
}

/** Feels gravity, does not source it, excluded from system totals. */
export function isTestParticle(body: SemanticBody): boolean {
  return body.gravityMode === 'test-particle';
}

/** Alias of isMassiveBody — the N-body force tree may only contain these. */
export function isGravitySource(body: SemanticBody): boolean {
  return isMassiveBody(body);
}
