import assert from 'node:assert/strict';
import test from 'node:test';
import { contactDisplacements, stepSpring } from '../src/puffy-title-physics.ts';

test('slow title return takes real time, is frame-rate independent and settles exactly', () => {
  const samples = [15, 30, 60, 144].map((fps) => {
    const state = { value: 1, velocity: 0 };
    for (let frame = 0; frame < fps; frame++) stepSpring(state, 0, 1 / fps, 3.4);
    assert.ok(
      state.value > 0.14 && state.value < 0.16,
      'Rotation remains visible after one second.',
    );
    const afterSecond = state.value;
    for (let frame = 0; frame < fps * 4; frame++) stepSpring(state, 0, 1 / fps, 3.4);
    assert.deepEqual(state, { value: 0, velocity: 0 });
    return afterSecond;
  });
  assert.ok(Math.max(...samples) - Math.min(...samples) < 1e-12);
});

test('contact dents the touched face, lifts a soft rim, and leaves distant/back vertices intact', () => {
  const positions = new Float32Array([0, 0, 0, 0.7, 0, 0, 1.1, 0, 0, 0, 0, -0.9, 0, 0, -0.1]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1]);
  const original = positions.slice();
  const offsets = contactDisplacements(positions, normals, [0, 0, 0], [0, 0, 1], 1, 0.2);
  assert.ok(offsets[2] < -0.19);
  assert.ok(offsets[3] > 0 && offsets[5] > 0, 'Displaced shoulder spreads and bulges.');
  assert.deepEqual([...offsets.slice(6)], Array(9).fill(0));
  assert.deepEqual(positions, original, 'Rest mesh is immutable.');
});

test('local contact follows its point and normal on a rotated surface', () => {
  const result = contactDisplacements(
    new Float32Array([2, 3, 4, 2, 5, 4]),
    new Float32Array([1, 0, 0, 1, 0, 0]),
    [2, 3, 4],
    [2, 0, 0],
    0.5,
    0.15,
  );
  assert.ok(result[0] < -0.149);
  assert.equal(result[1], 0);
  assert.equal(result[2], 0);
  assert.deepEqual([...result.slice(3)], [0, 0, 0]);
});

test('repeated presses recover without accumulating geometry drift or unstable springs', () => {
  const rest = new Float32Array([0, 0, 0]);
  const normal = new Float32Array([0, 0, 1]);
  const output = rest.slice();
  for (let press = 0; press < 30; press++) {
    const offset = contactDisplacements(rest, normal, [0, 0, 0], [0, 0, 1], 0.5, 0.2);
    const spring = { value: 0, velocity: 0 };
    for (let step = 0; step < 4; step++) stepSpring(spring, 1, 0.05, 17);
    assert.ok(spring.value > 0.8 && spring.value <= 1);
    for (let step = 0; step < 30; step++) {
      stepSpring(spring, 0, 0.2, 5.8);
      assert.ok(Number.isFinite(spring.value));
    }
    for (let i = 0; i < output.length; i++) output[i] = rest[i] + offset[i] * spring.value;
    assert.deepEqual(output, rest);
  }
});
