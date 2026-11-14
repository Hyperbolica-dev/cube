import assert from 'node:assert/strict';
import { IDS, POSITIONS, FRAMES, FACE_AXIS, TABLES, applyMove, solvedState, assertLegal, isSolved, mod3, type Eight, type Face, type Orientation, type Vector } from '../src/cube.ts';
import { RINGS, SLOTS, directedArc } from '../src/layout.ts';

const faces: Face[] = ['F', 'U', 'R'];
for (const face of faces) {
  let state = solvedState();
  for (let i = 0; i < 4; i++) {
    state = applyMove(state, { face, inverse: false });
    assertLegal(state);
  }
  assert.ok(isSolved(state), `${face}^4`);
  assert.deepEqual(applyMove(applyMove(solvedState(), { face, inverse: false }), { face, inverse: true }), solvedState());
}
assert.throws(() => assertLegal({ ...solvedState(), orientationAt: [1, 0, 0, 0, 0, 0, 0, 0] }));
assert.throws(() => assertLegal({ ...solvedState(), cubieAt: [0, 0, 2, 3, 4, 5, 6, 7] }));
assert.throws(() => assertLegal({ ...solvedState(), cubieAt: [7, 1, 2, 3, 4, 5, 6, 0] }));
assert.throws(() => assertLegal({ ...solvedState(), orientationAt: [2, 0, 0, 0, 0, 0, 0, 1] }));
assertLegal({ ...solvedState(), orientationAt: [1, 2, 0, 0, 0, 0, 0, 0] });
assertLegal({ ...solvedState(), cubieAt: [1, 0, 2, 3, 4, 5, 6, 7] });

// Independent physical oracle: Rodrigues rotation at -90 degrees, maintaining
// every sticker normal in world coordinates rather than adding twist values.
function physicalRotate(v: Vector, axis: number): Vector {
  const unit = [0, 0, 0];
  unit[axis] = 1;
  const cross = [unit[1] * v[2] - unit[2] * v[1], unit[2] * v[0] - unit[0] * v[2], unit[0] * v[1] - unit[1] * v[0]];
  return v.map((_, i) => unit[i] * v[axis] - cross[i]) as unknown as Vector;
}
const physical = POSITIONS.map((position, id) => ({ id, position, normals: [...FRAMES[id]] }));
let state = solvedState();
let seed = 0x1234abcd;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}
for (let step = 0; step < 10000; step++) {
  const face = faces[random() % 3], inverse = Boolean(random() & 0x100);
  const axis = FACE_AXIS[face];
  for (let turn = 0; turn < (inverse ? 3 : 1); turn++) {
    physical.forEach(cubie => {
      if (cubie.position[axis] !== 1) return;
      cubie.position = physicalRotate(cubie.position, axis);
      cubie.normals = cubie.normals.map(normal => physicalRotate(normal, axis));
    });
  }
  state = applyMove(state, { face, inverse });
  assertLegal(state);
  physical.forEach(cubie => {
    const slot = POSITIONS.findIndex(p => p.every((value, i) => value === cubie.position[i]));
    assert.equal(state.cubieAt[slot], cubie.id);
    cubie.normals.forEach((normal, k) => {
      const expected = FRAMES[slot][mod3(k + state.orientationAt[slot])];
      assert.ok(normal.every((value, i) => value === expected[i]), `Physical orientation mismatch at step ${step}`);
    });
  });
}
console.log('PASS: move orders, inverses, illegal-state boundaries, 10,000 physical-oracle moves');

for (const face of faces) {
  const ring = RINGS[face];
  let totalSweep = 0;
  TABLES[face].destination.forEach((target, source) => {
    if (source === target) return;
    assert.ok(Math.abs(Math.hypot(SLOTS[source].x - ring.center.x, SLOTS[source].y - ring.center.y) - ring.radius) < 1e-9);
    const arc = directedArc(SLOTS[source], SLOTS[target], ring, false);
    totalSweep += Math.abs(arc.sweep);
    assert.ok(Math.abs(ring.center.x + ring.radius * Math.cos(arc.start + arc.sweep) - SLOTS[target].x) < 1e-9);
    assert.ok(Math.abs(ring.center.y + ring.radius * Math.sin(arc.start + arc.sweep) - SLOTS[target].y) < 1e-9);
    const reverse = directedArc(SLOTS[target], SLOTS[source], ring, true);
    assert.ok(Math.abs(reverse.sweep + arc.sweep) < 1e-9);
  });
  assert.ok(Math.abs(totalSweep - 2 * Math.PI) < 1e-9, `${face} must visit consecutive circular slots`);
}
for (const [face, slot] of [['F', 6], ['U', 5]] as const) {
  assert.ok(Math.abs(SLOTS[slot].x + SLOTS[0].x - 2 * RINGS[face].center.x) < 1e-9);
  assert.ok(Math.abs(SLOTS[slot].y + SLOTS[0].y - 2 * RINGS[face].center.y) < 1e-9);
}
console.log('PASS: circle membership, directed forward/inverse arcs, G/F symmetry-axis intersections');

const factorial = [1, 1, 2, 6, 24, 120, 720, 5040];
function rankPermutation(permutation: number[]): number {
  let rank = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (permutation[j] < permutation[i]) smaller++;
    rank += smaller * factorial[6 - i];
  }
  return rank;
}
function unrankPermutation(rank: number): Eight<number> {
  const remaining = [0, 1, 2, 3, 4, 5, 6], result = [];
  for (let i = 0; i < 7; i++) {
    const index = Math.floor(rank / factorial[6 - i]);
    rank %= factorial[6 - i];
    result.push(remaining.splice(index, 1)[0]);
  }
  return [...result, 7] as Eight<number>;
}
function rankOrientation(orientation: Orientation[]): number {
  let rank = 0;
  for (let i = 5; i >= 0; i--) rank = rank * 3 + orientation[i];
  return rank;
}
function unrankOrientation(rank: number): Eight<Orientation> {
  const result: Orientation[] = [];
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const digit = (rank % 3) as Orientation;
    result.push(digit);
    sum += digit;
    rank = Math.floor(rank / 3);
  }
  return [...result, mod3(-sum), 0] as Eight<Orientation>;
}
const permutationNext = faces.map(() => new Uint16Array(5040));
const orientationNext = faces.map(() => new Uint16Array(729));
for (let p = 0; p < 5040; p++) {
  const cubieAt = unrankPermutation(p);
  assert.equal(rankPermutation(cubieAt), p);
  faces.forEach((face, f) => {
    permutationNext[f][p] = rankPermutation(applyMove({ ...solvedState(), cubieAt }, { face, inverse: false }).cubieAt);
  });
}
for (let o = 0; o < 729; o++) {
  const orientationAt = unrankOrientation(o);
  assert.equal(rankOrientation(orientationAt), o);
  faces.forEach((face, f) => {
    orientationNext[f][o] = rankOrientation(applyMove({ ...solvedState(), orientationAt }, { face, inverse: false }).orientationAt);
  });
}
const total = 5040 * 729;
const visited = new Uint8Array(total), queue = new Uint32Array(total);
let begin = 0, end = 1;
visited[0] = 1;
while (begin < end) {
  const code = queue[begin++], p = Math.floor(code / 729), o = code % 729;
  for (let f = 0; f < 3; f++) {
    const next = permutationNext[f][p] * 729 + orientationNext[f][o];
    if (!visited[next]) {
      visited[next] = 1;
      queue[end++] = next;
    }
  }
}
assert.equal(end, total);
console.log(`PASS: exhaustive F/U/R reachability = ${end.toLocaleString('en-US')} distinct legal states (${IDS[7]} fixed)`);
