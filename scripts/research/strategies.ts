import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { IDS, solvedState, isSolved, assertLegal, type CubeState } from '../../src/cube.ts';
import { execute, effect, format, inverse, conjugate, record, simplify, type Word, type Effect } from './algebra.ts';
import { createMethod, methodData, P, T, S, type Method } from './methods.ts';
import { PERMUTATIONS, ORIENTATIONS, STATES, rankOrientation, unrankOrientation, unrankPermutation } from './codec.ts';

const LIMITS = { milliseconds: 180000, rssMiB: 256, macroCount: 128, statesPerStrategy: STATES, randomReplaysPerStrategy: 2000 };
const started = performance.now();
function budget(): void {
  if (performance.now() - started > LIMITS.milliseconds) throw new Error('Strategy experiment time bound reached; no complete certificate emitted');
  if (process.memoryUsage().rss > LIMITS.rssMiB * 1024 ** 2) throw new Error('Strategy experiment RSS bound reached');
}
interface Macro { word: Word; action: Effect; transition: Uint16Array; cost: number }
const macros: Macro[] = [], macroByWord = new Map<string, number>();
function register(word: Word): number {
  const name = format(word);
  const existing = macroByWord.get(name);
  if (existing !== undefined) return existing;
  assert.ok(macros.length < LIMITS.macroCount, 'Macro count budget');
  const simple = simplify(word), action = effect(simple), transition = new Uint16Array(ORIENTATIONS);
  // Official-model replay for ALL 729 orientation vectors of each macro.
  for (let o = 0; o < ORIENTATIONS; o++) {
    const result = execute({ ...solvedState(), orientationAt: unrankOrientation(o) }, simple);
    transition[o] = rankOrientation(result.orientationAt);
  }
  const id = macros.length;
  macros.push({ word: simple, action, transition, cost: simple.length });
  macroByWord.set(name, id);
  return id;
}
interface Instruction { kind: 'move' | 'twist'; target: number; positive: number; negative: number; phase: 'position' | 'orientation' }
interface Program { instructions: Instruction[] }
const orientationDigit = IDS.slice(0, 7).map((_, p) => Uint8Array.from({ length: ORIENTATIONS }, (_, o) => unrankOrientation(o)[p]));

function compile(method: Method, permutation: number, mixed: boolean): Program {
  const initial = { ...solvedState(), cubieAt: unrankPermutation(permutation) };
  const position = method.solvePositions(initial);
  const instructions: Instruction[] = [];
  function addMove(word: Word, target = -1): void {
    const id = register(word);
    instructions.push({ kind: 'move', target, positive: id, negative: id, phase: 'position' });
  }
  function addTwist(target: number): void {
    const tuple = method.hub === 0 ? [target] : [method.hub, target];
    const preparation = method.twistPreparations.get(tuple.join(','))!;
    const positive = register(conjugate(preparation.word, T));
    const negative = register(conjugate(preparation.word, inverse(T)));
    instructions.push({ kind: 'twist', target, positive, negative, phase: 'orientation' });
  }
  if (mixed) {
    for (const step of position.steps) if (step.phase === 'parity') addMove(step.word);
    for (const target of method.orientationOrder) {
      for (const step of position.steps) if (step.phase === 'position' && step.target === IDS[target]) addMove(step.word, target);
      addTwist(target);
    }
  } else {
    for (const step of position.steps) addMove(step.word, step.target ? IDS.indexOf(step.target as typeof IDS[number]) : -1);
    for (const target of method.orientationOrder) addTwist(target);
  }
  // Independently certify that either sign of each conditional twist fixes positions,
  // and that mandatory moves solve this permutation.
  let state = initial;
  const locked = new Set<number>();
  for (const instruction of instructions) {
    if (instruction.kind === 'move') {
      const before = state;
      state = execute(state, macros[instruction.positive].word);
      if (mixed) for (const p of locked) {
        assert.equal(state.cubieAt[p], before.cubieAt[p]);
        assert.equal(state.orientationAt[p], before.orientationAt[p]);
      }
    } else {
      for (const id of [instruction.positive, instruction.negative]) {
        const e = macros[id].action;
        assert.ok(e.destination.every((p, source) => p === source));
        assert.ok(e.twist.every((o, p) => p === method.hub || p === instruction.target || o === 0));
      }
      if (mixed) {
        assert.equal(state.cubieAt[instruction.target], instruction.target);
        locked.add(instruction.target);
      }
    }
  }
  assert.ok(state.cubieAt.every((p, slot) => p === slot));
  return { instructions };
}
function runProgram(program: Program, orientation: number) {
  let cost = 0, moves = 0, positionCost = 0, orientationCost = 0;
  for (const instruction of program.instructions) {
    let id = instruction.positive;
    if (instruction.kind === 'twist') {
      const digit = orientationDigit[instruction.target][orientation];
      if (digit === 0) continue;
      if (digit === 1) id = instruction.negative;
    }
    const macro = macros[id];
    orientation = macro.transition[orientation];
    cost += macro.cost;
    moves++;
    if (instruction.phase === 'position') positionCost += macro.cost;
    else orientationCost += macro.cost;
  }
  return { orientation, cost, moves, positionCost, orientationCost };
}
function replay(program: Program, initial: CubeState) {
  let state = initial;
  const word: Word = [];
  for (const instruction of program.instructions) {
    let id = instruction.positive;
    if (instruction.kind === 'twist') {
      const digit = state.orientationAt[instruction.target];
      if (!digit) continue;
      if (digit === 1) id = instruction.negative;
    }
    word.push(...macros[id].word);
    state = execute(state, macros[id].word);
    assertLegal(state);
  }
  assert.ok(isSolved(state));
  return word;
}
let seed = 0x63756265;
function random(): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
function evaluate(method: Method, mixed = false) {
  const id = mixed ? 'hub-mixed-stabilizers' : method.id;
  const programs = Array.from({ length: PERMUTATIONS }, (_, p) => { if ((p & 63) === 0) budget(); return compile(method, p, mixed); });
  let solved = 0, costSum = 0, maximum = 0, macroSum = 0, positionSum = 0, orientationSum = 0, maxCode = 0;
  const histogram: number[] = [];
  for (let p = 0; p < PERMUTATIONS; p++) {
    if ((p & 63) === 0) budget();
    for (let o = 0; o < ORIENTATIONS; o++) {
      const result = runProgram(programs[p], o);
      assert.equal(result.orientation, 0);
      solved++; costSum += result.cost; macroSum += result.moves;
      positionSum += result.positionCost; orientationSum += result.orientationCost;
      histogram[result.cost] = (histogram[result.cost] ?? 0) + 1;
      if (result.cost > maximum) { maximum = result.cost; maxCode = p * ORIENTATIONS + o; }
    }
  }
  assert.equal(solved, STATES);
  seed = 0x63756265; // Paired legal states across strategies, not different scramble distributions.
  const sample = { seedBefore: seed, count: LIMITS.randomReplaysPerStrategy, costSum: 0, maximum: 0, simplifiedCostSum: 0 };
  for (let n = 0; n < sample.count; n++) {
    if ((n & 127) === 0) budget();
    const p = random() % PERMUTATIONS, o = random() % ORIENTATIONS;
    const word = replay(programs[p], { cubieAt: unrankPermutation(p), orientationAt: unrankOrientation(o) });
    const compact = runProgram(programs[p], o);
    assert.equal(word.length, compact.cost);
    sample.costSum += word.length; sample.maximum = Math.max(sample.maximum, word.length); sample.simplifiedCostSum += simplify(word).length;
  }
  const worstP = Math.floor(maxCode / ORIENTATIONS), worstO = maxCode % ORIENTATIONS;
  const worstWord = replay(programs[worstP], { cubieAt: unrankPermutation(worstP), orientationAt: unrankOrientation(worstO) });
  return {
    id, coverage: { permutations: PERMUTATIONS, orientationsPerPermutation: ORIENTATIONS, states: solved, successRate: 1, cutOff: false,
      method: 'Every macro orientation transition is replayed officially for 729 vectors; mandatory permutations are replayed for 5040 permutations; all 3,674,160 conditional programs are then evaluated exactly.' },
    cost: { metric: 'QTM, execute each normalized macro; no cross-macro cancellations', total: costSum, mean: costSum / solved, maximum, meanMacros: macroSum / solved, meanPosition: positionSum / solved, meanOrientation: orientationSum / solved, histogram: Array.from({ length: histogram.length }, (_, i) => histogram[i] ?? 0) },
    randomOfficialReplay: { ...sample, mean: sample.costSum / sample.count, meanAfterCrossMacroSimplification: sample.simplifiedCostSum / sample.count, successRate: 1 },
    worstExample: { cubieAt: unrankPermutation(worstP), orientationAt: unrankOrientation(worstO), sequenceAfterCrossMacroSimplification: format(worstWord), simplifiedLength: simplify(worstWord).length, executionLength: worstWord.length },
    recognition: mixed ? 'At each target: cubie identity plus orientation; earlier targets fully fixed.' : 'First cubie identities and permutation parity; then one target orientation at a time.',
    backtracking: false,
  };
}

const hub = createMethod('hub-hinges'), leaf = createMethod('leaf-buffer');
const results = [evaluate(leaf), evaluate(hub), evaluate(hub, true)];
// The pure-twist basis has one independent +1 coordinate for every non-hub slot.
const twistBasis = hub.orientationOrder.map(target => {
  const k = hub.twistPreparations.get(String(target))!.word;
  const e = effect(conjugate(k, T));
  assert.equal(e.twist[target], 1); assert.equal(e.twist[0], 2);
  assert.ok(e.twist.every((o, p) => p === 0 || p === target || o === 0));
  return record(conjugate(k, T), 'pure-orientation-basis', `Twist ${IDS[target]} +1 and buffer A -1; all other full states fixed.`);
});
const obstruction = effect(P);
assert.ok([6, 5, 3].every(p => obstruction.destination[p] === p && obstruction.twist[p] === 0));
assert.ok(obstruction.destination.some((p, source) => p !== source));
const output = {
  modelSha256: createHash('sha256').update(readFileSync(fileURLToPath(new URL('../../src/cube.ts', import.meta.url)))).digest('hex'),
  convention: 'Chronological left-to-right words; destination and twist indexed by SOURCE slot; primitive F/U/R and inverse cost 1 QTM, half turn costs 2.',
  limits: LIMITS,
  exhaustiveCertificateAssumptions: [
    'Official applyMove copies source cubie identity and adds a source-slot-dependent twist; orientation evolution is independent of the input cubie permutation.',
    'All transition entries are derived by execute/applyMove, not independent orientation rules.',
    'Conditional twists have identity permutation, so the mandatory permutation certificate is valid for every branch.',
  ],
  macros: { commutator: record(S, 'commutator', 'Double transposition, not a three-cycle.'), position: record(P, 'nested-commutator', 'Three-cycle A→B→C→A; twists stay within that support.'), orientation: record(T, 'pure-pair-twist', 'A -1,D +1; position identity.'), twistBasis },
  preparations: [methodData(hub), methodData(leaf)],
  literalBufferFreeze: { refuted: true, witness: record(P, 'counterexample', 'G,F,D are fully solved, A/B/C are not. Forbidding every primitive that moves a solved leaf forbids F,U,R, so this policy deadlocks.'), note: 'This refutes permanent primitive protection, not prepare/local/undo buffering.' },
  strategies: results, transitionMacros: macros.length,
};
mkdirSync(fileURLToPath(new URL('../../research/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../../research/strategies.json', import.meta.url)), JSON.stringify(output, null, 2) + '\n');
for (const result of results) console.log(`${result.id}: ${result.coverage.states} / ${STATES}; mean ${result.cost.mean.toFixed(6)} QTM; max ${result.cost.maximum}; official random replays ${result.randomOfficialReplay.count}`);
console.log(`Macro orientation tables: ${macros.length} × ${ORIENTATIONS} official replays; runtime ${(performance.now() - started).toFixed(0)} ms; RSS ${(process.memoryUsage().rss / 1024 ** 2).toFixed(1)} MiB`);
