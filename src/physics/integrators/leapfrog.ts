import type { Integrator, IntegratorWorld } from '../types.ts';

/**
 * Velocity Verlet / kick-drift-kick leapfrog.
 * PHYSICAL MODEL — symplectic, 2nd order, time-reversible.
 * Default integrator. Phase 1 ships only this one.
 */
export const leapfrog: Integrator = {
  name: 'leapfrog',
  step(world: IntegratorWorld): void {
    const { bodies, dt, computeAccel } = world;
    const half = dt * 0.5;
    for (const b of bodies) {
      if (b.fixed) continue;
      b.vx += b.ax * half;
      b.vy += b.ay * half;
      b.vz += b.az * half;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
    computeAccel();
    for (const b of bodies) {
      if (b.fixed) continue;
      b.vx += b.ax * half;
      b.vy += b.ay * half;
      b.vz += b.az * half;
    }
  },
};
