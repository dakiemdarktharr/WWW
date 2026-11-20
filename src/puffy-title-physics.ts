export type Spring = { value: number; velocity: number };

/** Analytic critically damped spring: the same return time at 15 Hz and 144 Hz. */
export function stepSpring(state: Spring, target: number, dt: number, frequency: number): void {
  const offset = state.value - target;
  const coefficient = state.velocity + frequency * offset;
  const decay = Math.exp(-frequency * dt);
  state.value = target + (offset + coefficient * dt) * decay;
  state.velocity = (state.velocity - frequency * coefficient * dt) * decay;
  if (Math.abs(state.value - target) + Math.abs(state.velocity) < 0.00015) {
    state.value = target;
    state.velocity = 0;
  }
}

export type Point3 = readonly [number, number, number];

/** A fingertip contact patch with a compressed center and a soft displaced rim.
 * The rest mesh never changes; repeated presses therefore cannot accumulate drift.
 * Facing/depth masks prevent a press from pulling through the back of a balloon.
 */
export function contactDisplacements(
  positions: Float32Array,
  normals: Float32Array,
  center: Point3,
  outward: Point3,
  radius: number,
  depth: number,
): Float32Array {
  const result = new Float32Array(positions.length);
  const normalLength = Math.hypot(...outward) || 1;
  const nx = outward[0] / normalLength;
  const ny = outward[1] / normalLength;
  const nz = outward[2] / normalLength;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - center[0];
    const dy = positions[i + 1] - center[1];
    const dz = positions[i + 2] - center[2];
    const axial = dx * nx + dy * ny + dz * nz;
    const tx = dx - axial * nx;
    const ty = dy - axial * ny;
    const tz = dz - axial * nz;
    const radial = Math.hypot(tx, ty, tz) / radius;
    if (radial >= 1 || Math.abs(axial) >= radius * 0.85) continue;
    const facing = Math.max(0, normals[i] * nx + normals[i + 1] * ny + normals[i + 2] * nz);
    const through = Math.max(0, 1 - (axial / (radius * 0.85)) ** 2);
    const mask = facing * through * through;
    const edge = (1 - radial * radial) ** 2;
    // The annular shoulder restores some displaced volume; it is not a full cloth solver.
    const shoulder = 0.2 * Math.exp(-(((radial - 0.64) / 0.19) ** 2));
    const pressure = depth * mask * (shoulder - edge * Math.exp(-2.2 * radial * radial));
    const spread = (depth * 0.13 * mask * edge) / radius;
    result[i] = nx * pressure + tx * spread;
    result[i + 1] = ny * pressure + ty * spread;
    result[i + 2] = nz * pressure + tz * spread;
  }
  return result;
}
