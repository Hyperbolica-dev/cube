import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { solvedState, assertLegal, type CubeState } from '../../src/cube.ts';
import { effect, execute, parse, inverse, act, key, order, support, fixed, simplify, type Word } from './algebra.ts';
import { createMethod } from './methods.ts';
import { STATES, PERMUTATIONS, ORIENTATIONS, rankState, unrankState, rankPermutation, unrankPermutation, rankOrientation, unrankOrientation } from './codec.ts';
import { isObject, readObject } from './artifacts.ts';

const started = performance.now(), root = fileURLToPath(new URL('../../', import.meta.url));
const modelHash = createHash('sha256').update(readFileSync(root + 'src/cube.ts')).digest('hex');
let records = 0;
function visit(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(visit); return; }
  if (!isObject(value)) return;
  const node = value;
  if (typeof node.sequence === 'string' && Array.isArray(node.destination) && (Array.isArray(node.sourceTwist) || Array.isArray(node.orientation))) {
    assert.ok(++records <= 5000, 'Artifact record budget');
    const word = parse(node.sequence), e = effect(word);
    assert.deepEqual(e.destination, node.destination);
    assert.deepEqual(e.twist, node.sourceTwist ?? node.orientation);
    if (Array.isArray(node.support)) assert.deepEqual(support(e), node.support);
    if (Array.isArray(node.fixed)) assert.deepEqual(fixed(e), node.fixed);
    if (typeof node.order === 'number') assert.equal(order(e), node.order);
    if (typeof node.qtm === 'number') assert.equal(word.length, node.qtm);
    if (typeof node.length === 'number') assert.equal(word.length, node.length);
    assert.equal(key(execute(execute(solvedState(), word), inverse(word))), key(solvedState()));
  }
  Object.values(node).forEach(visit);
  if (performance.now() - started > 60000) throw new Error('Artifact verification exceeded 60 seconds');
}
for (const file of ['commutators.json', 'stabilizers.json', 'strategies.json', 'local-operations.json', 'summary.json']) {
  const artifact = readObject(root + 'research/' + file);
  if (file === 'commutators.json') {
    const search = artifact.search;
    assert.ok(isObject(search));
    assert.equal(search.cutoff, null); assert.equal(search.completedDeclaredFamilies, true);
    assert.ok(Array.isArray(artifact.basic81)); assert.equal(artifact.basic81.length, 81);
  }
  if (file === 'stabilizers.json') {
    assert.ok(isObject(artifact.locality)); assert.equal(artifact.locality.completeThroughQTM8, true);
    assert.ok(isObject(artifact.chain)); assert.equal(artifact.chain.orbitProduct, STATES);
  }
  if (file === 'strategies.json') {
    assert.equal(artifact.modelSha256, modelHash);
    assert.ok(Array.isArray(artifact.strategies));
    for (const strategy of artifact.strategies) {
      assert.ok(isObject(strategy) && isObject(strategy.coverage));
      assert.equal(strategy.coverage.states, STATES); assert.equal(strategy.coverage.cutOff, false);
    }
  }
  if (file === 'local-operations.json') {
    assert.ok(isObject(artifact.model)); assert.equal(artifact.model.sha256, modelHash);
  }
  if (file === 'summary.json') assert.equal(artifact.modelSha256, modelHash);
  visit(artifact);
}
for (let p = 0; p < PERMUTATIONS; p++) assert.equal(rankPermutation(unrankPermutation(p)), p);
for (let o = 0; o < ORIENTATIONS; o++) assert.equal(rankOrientation(unrankOrientation(o)), o);
for (const code of [0, ORIENTATIONS - 1, ORIENTATIONS, STATES - 1]) assert.equal(rankState(unrankState(code)), code);
let seed = 0x72657365;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
for (let sample = 0; sample < 500; sample++) {
  const state: CubeState = unrankState(random() % STATES), word: Word = [];
  for (let i = 0; i < 20; i++) word.push({ face: (['F', 'U', 'R'] as const)[random() % 3], inverse: Boolean(random() & 0x100) });
  const direct = execute(state, word), induced = act(state, effect(word));
  assert.deepEqual(induced, direct);
  assert.deepEqual(execute(state, simplify(word)), direct);
  assertLegal(induced);
}
for (const kind of ['hub-hinges', 'leaf-buffer'] as const) {
  const method = createMethod(kind);
  for (let sample = 0; sample < 100; sample++) {
    const state = unrankState(random() % STATES), plan = method.solve(state);
    assert.deepEqual(execute(state, plan.steps.flatMap(step => step.word)), plan.result);
  }
}
console.log(`PASS: ${records} serialized full effects replayed, orders/support/fixed/inverses checked; compact codec boundaries; 500 arbitrary-state induced-action checks; 200 solver replays; model SHA-256 ${modelHash}`);
