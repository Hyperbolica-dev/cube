import assert from 'node:assert/strict';
import { IDS, isSolved, assertLegal, type CubeState } from '../../src/cube.ts';
import { parse, inverse, conjugate, commutator, execute, effect, act, format, record, MOVES, type Word, type Effect } from './algebra.ts';

export const S = commutator(parse('F'), parse('U'));
export const P = commutator(S, parse('R'));
export const T = commutator([...S, ...S], parse("R'"));
export const HINGES = ['U F', "F' U'", 'F R', "R' F'", 'R U', "U' R'"].map(parse);
export interface Preparation { tracked: number[]; word: Word }

/** Reverse BFS of at most 210 tracked-slot tuples, never a full cube solver. */
export function preparations(target: number[], generators: Word[], expected: number): Map<string, Preparation> {
  const deadline = performance.now() + 5000;
  const routes = new Map<string, Preparation>();
  const queue = [{ tracked: target, word: [] as Word }];
  const backwards = generators.map(word => effect(inverse(word)));
  routes.set(target.join(','), queue[0]);
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 210 || performance.now() > deadline) throw new Error('Preparation orbit exceeded 210 nodes / 5 seconds');
    const current = queue[index];
    generators.forEach((generator, i) => {
      const tracked = current.tracked.map(p => backwards[i].destination[p]);
      const key = tracked.join(',');
      if (!routes.has(key)) {
        const next = { tracked, word: [...generator, ...current.word] };
        routes.set(key, next);
        queue.push(next);
      }
    });
  }
  assert.equal(routes.size, expected);
  for (const route of routes.values()) {
    const e = effect(route.word);
    assert.deepEqual(route.tracked.map(p => e.destination[p]), target);
  }
  return routes;
}
export interface Step {
  phase: 'parity' | 'position' | 'orientation';
  target: string;
  word: Word;
  explanation: string;
}
export interface Plan { steps: Step[]; result: CubeState }
export interface Method {
  id: string;
  hub: number;
  positionOrder: number[];
  orientationOrder: number[];
  pairPreparations: Map<string, Preparation>;
  twistPreparations: Map<string, Preparation>;
  solvePositions(state: CubeState): Plan;
  solveOrientations(state: CubeState): Plan;
  solve(state: CubeState): Plan;
}
export function permutationParity(state: CubeState): number {
  let parity = 0;
  for (let p = 0; p < 7; p++) for (let q = p + 1; q < 7; q++) if (state.cubieAt[p] > state.cubieAt[q]) parity ^= 1;
  return parity;
}

export function createMethod(kind: 'hub-hinges' | 'leaf-buffer'): Method {
  const hub = kind === 'hub-hinges' ? 0 : 6;
  const pairPreparations = kind === 'hub-hinges'
    ? preparations([1, 2], HINGES, 30)
    : preparations([0, 1, 2], MOVES.map(m => [m]), 210);
  const twistPreparations = kind === 'hub-hinges'
    ? preparations([3], HINGES, 6)
    : preparations([0, 3], MOVES.map(m => [m]), 42);
  for (const hinge of HINGES) assert.equal(effect(hinge).destination[0], 0);
  const order = [6, 5, 3, 4, 1, 2, 0].filter(p => p !== hub);
  const positionOrder = order.slice(0, 5);
  const orientationOrder = order;
  const cache = new Map<string, { word: Word; action: Effect }>();
  function prepared(k: Word, base: Word, reverse = false) {
    const word = conjugate(k, reverse ? inverse(base) : base), name = format(word);
    let cached = cache.get(name);
    if (!cached) { cached = { word, action: effect(word) }; cache.set(name, cached); }
    return cached;
  }
  function solvePositions(initial: CubeState): Plan {
    let state = initial;
    const steps: Step[] = [], locked: number[] = [];
    if (permutationParity(state)) {
      const word = parse('F');
      state = execute(state, word);
      steps.push({ phase: 'parity', target: '', word, explanation: 'Odd permutation: one F turn makes it even before any slot is protected.' });
    }
    for (const p of positionOrder) {
      if (state.cubieAt[p] !== p) {
        const q = state.cubieAt.indexOf(p);
        const r = q === hub ? [...order].reverse().find(slot => slot !== p && !locked.includes(slot))! : hub;
        const pair = q === hub ? [p, r] : [q, p];
        const tuple = kind === 'hub-hinges' ? pair : [hub, ...pair];
        const k = pairPreparations.get(tuple.join(','));
        if (!k) throw new Error('Missing position preparation');
        const operation = prepared(k.word, P);
        const before = state;
        state = act(state, operation.action);
        for (const fixed of locked) {
          assert.equal(state.cubieAt[fixed], before.cubieAt[fixed]);
          assert.equal(state.orientationAt[fixed], before.orientationAt[fixed]);
        }
        assert.equal(state.cubieAt[p], p);
        steps.push({ phase: 'position', target: IDS[p], word: operation.word,
          explanation: `Prepare ${tuple.map(i => IDS[i]).join(',')}; hub 3-cycle installs ${IDS[p]}; undo preparation.` });
      }
      locked.push(p);
    }
    assert.ok(state.cubieAt.every((cubie, slot) => cubie === slot));
    return { steps, result: state };
  }
  function solveOrientations(initial: CubeState): Plan {
    assert.ok(initial.cubieAt.every((cubie, slot) => cubie === slot));
    let state = initial;
    const steps: Step[] = [];
    for (const p of orientationOrder) {
      if (state.orientationAt[p] === 0) continue;
      const tuple = kind === 'hub-hinges' ? [p] : [hub, p];
      const k = twistPreparations.get(tuple.join(','));
      if (!k) throw new Error('Missing orientation preparation');
      const operation = prepared(k.word, T, state.orientationAt[p] === 1);
      const before = state;
      state = act(state, operation.action);
      assert.ok(state.cubieAt.every((cubie, slot) => cubie === slot));
      for (let slot = 0; slot < 8; slot++) if (slot !== hub && slot !== p) assert.equal(state.orientationAt[slot], before.orientationAt[slot]);
      assert.equal(state.orientationAt[p], 0);
      steps.push({ phase: 'orientation', target: IDS[p], word: operation.word,
        explanation: `Prepare ${IDS[p]} at D; pair twist ${IDS[p]} against hub ${IDS[hub]}; undo preparation.` });
    }
    assertLegal(state);
    assert.ok(isSolved(state));
    return { steps, result: state };
  }
  function solve(state: CubeState): Plan {
    assertLegal(state);
    const first = solvePositions(state), second = solveOrientations(first.result);
    return { steps: [...first.steps, ...second.steps], result: second.result };
  }
  return { id: kind, hub, positionOrder, orientationOrder, pairPreparations, twistPreparations, solvePositions, solveOrientations, solve };
}
export function methodData(method: Method) {
  return {
    id: method.id, hub: IDS[method.hub], positionOrder: method.positionOrder.map(p => IDS[p]), orientationOrder: method.orientationOrder.map(p => IDS[p]),
    hinges: HINGES.map(word => record(word, 'preparation-hinge', 'Returns A to its position, not necessarily its orientation.')),
    positionPreparations: [...method.pairPreparations.values()].filter(route => method.hub === 0 || route.tracked[0] === method.hub).map(route => ({ tracked: route.tracked.map(p => IDS[p]), sequence: format(route.word), length: route.word.length })),
    orientationPreparations: [...method.twistPreparations.values()].filter(route => method.hub === 0 || route.tracked[0] === method.hub).map(route => ({ tracked: route.tracked.map(p => IDS[p]), sequence: format(route.word), length: route.word.length })),
  };
}
export const planWord = (plan: Plan): Word => plan.steps.flatMap(step => step.word);
export function replayPlan(state: CubeState, plan: Plan): void {
  const replayed = execute(state, planWord(plan));
  assert.deepEqual(replayed, plan.result);
  assert.ok(isSolved(replayed));
}
