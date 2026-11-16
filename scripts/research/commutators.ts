import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDS, POSITIONS, assertLegal, mod3, solvedState, type CubeState, type Eight, type Orientation } from '../../src/cube.ts';
import { MOVES, act, commutator, conjugate, cycles, effect, execute, fixed, format, inverse, order, parse, pure, simplify, support, type Effect, type Word } from './algebra.ts';
// Run: node --experimental-strip-types scripts/research/commutators.ts
// No independent move tables: every candidate action is replayed with execute/applyMove.
const LIMITS = { expandedQtm: 24, candidates: 100_000, seconds: 120, candidateStorageMiB: 128,
  nestedDepth: 3, preparationDepthQtm: 3, uniqueElements: 30_000, frontierEntries: 4_000 } as const;
const started = performance.now();
const faces = ['F', "F'", 'F2', 'U', "U'", 'U2', 'R', "R'", 'R2'];
interface Candidate { expression: string; word: Word; expandedQtm: number; depth: number; family: string }
interface Saved extends Candidate { e: Effect; groupKey: string }
const basics: Saved[] = [], powers: Saved[] = [], firstNested: Saved[] = [];
const seen = new Set<string>();
const selected = new Map<string, Saved[]>();
const counters: Record<string, { considered: number; rejectedLength: number; replayed: number; unique: number }> = {};
const classification: Record<string, number> = {};
let replayed = 0, cutoff: string | null = null, maximumEstimatedCandidateStorageBytes = 0;
// Conservative accounting allowance per stored string/key/word, not an RSS claim.
const estimatedStorage = () => seen.size * 512 + (basics.length + powers.length + firstNested.length + [...selected.values()].reduce((n, a) => n + a.length, 0)) * 4096;
const compare = (a: Candidate, b: Candidate) => a.word.length - b.word.length || format(a.word).split(' ').filter(Boolean).length - format(b.word).split(' ').filter(Boolean).length || a.expandedQtm - b.expandedQtm || (a.expression < b.expression ? -1 : a.expression > b.expression ? 1 : 0);
function classes(e: Effect): string[] {
  const cs = cycles(e), identity = support(e).length === 0, noTwist = e.twist.every(t => t === 0);
  const out = [identity ? 'identity' : pure(e) ? `pure-twist-${support(e).length}` : `permutation-${cs.map(c => c.length).sort((a,b) => b-a).join('+')}`];
  if (!identity && noTwist) out.push('zero-source-twist');
  if (pure(e) && support(e).length === 2) out.push('pair-twist');
  if (noTwist && cs.length === 1 && cs[0].length === 3) out.push('clean-three-cycle');
  if (noTwist && cs.length === 1 && cs[0].length === 2) out.push('clean-transposition');
  if (noTwist && cs.length === 2 && cs.every(c => c.length === 2)) out.push('clean-double-transposition');
  return out;
}
function consider(c: Candidate): Saved | undefined {
  const stat = counters[c.family] ??= { considered: 0, rejectedLength: 0, replayed: 0, unique: 0 };
  stat.considered++;
  if (c.expandedQtm > LIMITS.expandedQtm) { stat.rejectedLength++; return; }
  if (cutoff) return;
  if (replayed >= LIMITS.candidates) { cutoff = 'candidate-count'; return; }
  if ((performance.now() - started) / 1000 >= LIMITS.seconds) { cutoff = 'time'; return; }
  if (seen.size >= LIMITS.uniqueElements || estimatedStorage() + 8192 > LIMITS.candidateStorageMiB * 1024 ** 2) { cutoff = 'candidate-storage'; return; }
  c.word = simplify(c.word);
  const e = effect(c.word), groupKey = e.destination.join('') + ':' + e.twist.join('');
  const saved: Saved = { ...c, e, groupKey };
  replayed++; stat.replayed++;
  if (!seen.has(groupKey)) {
    seen.add(groupKey); stat.unique++;
    for (const category of classes(e)) classification[category] = (classification[category] ?? 0) + 1;
  }
  for (const category of classes(e)) {
    const bucket = selected.get(category) ?? [];
    const previous = bucket.findIndex(item => item.groupKey === groupKey);
    if (previous >= 0) { if (compare(saved, bucket[previous]) < 0) bucket[previous] = saved; }
    else bucket.push(saved);
    bucket.sort(compare);
    if (bucket.length > 6) bucket.length = 6;
    selected.set(category, bucket);
  }
  maximumEstimatedCandidateStorageBytes = Math.max(maximumEstimatedCandidateStorageBytes, estimatedStorage());
  return saved;
}
const makeCommutator = (x: Candidate, y: Candidate, family: string): Candidate => ({
  expression: `[${x.expression},${y.expression}]`, word: commutator(x.word, y.word), expandedQtm: 2 * (x.expandedQtm + y.expandedQtm), depth: Math.max(x.depth, y.depth) + 1, family,
});
const single = faces.map(expression => ({ expression, word: parse(expression), expandedQtm: parse(expression).length, depth: 0, family: 'face-power' }));
for (const x of single) for (const y of single) {
  const result = consider(makeCommutator(x, y, 'basic81'));
  assert.ok(result); basics.push(result);
}
for (const b of basics) {
  powers.push(b);
  for (let n = 2; n * b.expandedQtm <= LIMITS.expandedQtm; n++) {
    const result = consider({ expression: `${b.expression}^${n}`, word: Array.from({ length: n }, () => b.word).flat(), expandedQtm: n * b.expandedQtm, depth: 1, family: 'basic-powers' });
    if (result) powers.push(result);
  }
}
// Priority family includes [[F,U]^2,R], a pure opposite pair twist.
for (const p of powers) for (const x of single) for (const reversed of [false, true]) {
  const result = consider(reversed ? makeCommutator(x, p, 'power-face') : makeCommutator(p, x, 'power-face'));
  if (result && p.expression.indexOf('^') < 0) firstNested.push(result);
}
for (const x of basics) for (const y of basics) consider(makeCommutator(x, y, 'basic-basic'));
assert.ok(firstNested.length <= LIMITS.frontierEntries);
for (const x of firstNested) for (const y of single) for (const reversed of [false, true]) {
  consider(reversed ? makeCommutator(y, x, 'nested-face-depth3') : makeCommutator(x, y, 'nested-face-depth3'));
}
// Take short powers of every first nested expression without storing raw search results.
for (const x of firstNested) for (let n = 2; n * x.expandedQtm <= LIMITS.expandedQtm; n++) {
  consider({ expression: `${x.expression}^${n}`, word: Array.from({ length: n }, () => x.word).flat(), expandedQtm: n * x.expandedQtm, depth: x.depth, family: 'nested-powers' });
}
function trajectory(word: Word) {
  let state = solvedState();
  const moved = new Set<string>(), affected = new Set<string>();
  const prefixes = [state];
  for (const move of word) {
    state = execute(state, [move]); prefixes.push(state);
    for (let slot = 0; slot < 8; slot++) {
      if (state.cubieAt[slot] !== slot) moved.add(IDS[state.cubieAt[slot]]);
      if (state.cubieAt[slot] !== slot || state.orientationAt[slot] !== 0) affected.add(IDS[state.cubieAt[slot]]);
    }
  }
  return { temporarilyMovedSourceSlots: IDS.filter(id => moved.has(id)), temporarilyAffectedSourceSlots: IDS.filter(id => affected.has(id)), prefixes };
}
function fullRecord(c: Candidate) {
  // Replaying every emitted record independently, not trusting cached candidate effects.
  const e = effect(c.word), cs = cycles(e), trace = trajectory(c.word);
  return { expression: c.expression, family: c.family, nestedDepth: c.depth, sequence: format(c.word),
    expandedQtm: c.expandedQtm, qtm: c.word.length, htm: format(c.word).split(' ').filter(Boolean).length,
    destination: e.destination, sourceTwist: e.twist,
    action: IDS.map((source, p) => ({ source, destination: IDS[e.destination[p]], twist: e.twist[p] })),
    permutationCycles: cs, permutationCycleType: cs.map(cycle => cycle.length).sort((a,b) => b-a),
    cycleOrientation: cs.map(cycle => ({ cycle, sourceTwists: cycle.map(id => e.twist[IDS.indexOf(id as typeof IDS[number])]), sumMod3: mod3(cycle.reduce((n, id) => n + e.twist[IDS.indexOf(id as typeof IDS[number])], 0)) })),
    permutationSupport: IDS.filter((_, p) => e.destination[p] !== p),
    orientationOnlySupport: IDS.filter((_, p) => e.destination[p] === p && e.twist[p] !== 0),
    zeroSourceTwistCycles: cs.filter(cycle => cycle.every(id => e.twist[IDS.indexOf(id as typeof IDS[number])] === 0)),
    support: support(e), fixed: fixed(e), order: order(e), classifications: classes(e),
    temporarilyMovedSourceSlots: trace.temporarilyMovedSourceSlots, temporarilyAffectedSourceSlots: trace.temporarilyAffectedSourceSlots,
  };
}
const tutorialPosition = firstNested.find(c => c.expression === '[[F,U],R]');
const squaredFU = powers.find(c => c.expression === '[F,U]^2');
const inverseR = single.find(c => c.expression === "R'");
assert.ok(tutorialPosition && squaredFU && inverseR);
const tutorialTwist = makeCommutator(squaredFU, inverseR, 'power-face');
const tutorialTwistEffect = effect(tutorialTwist.word);
const tutorialTwistSaved: Saved = { ...tutorialTwist, e: tutorialTwistEffect, groupKey: tutorialTwistEffect.destination.join('') + ':' + tutorialTwistEffect.twist.join('') };
const curated = [...new Map([...selected.values()].flat().concat([tutorialPosition, tutorialTwistSaved]).map(c => [c.groupKey, c])).values()].sort(compare);
const pair = selected.get('pair-twist')?.[0], cleanThree = selected.get('clean-three-cycle')?.[0];
assert.ok(pair, 'Priority family must find an orientation pair');
const preparations: Word[] = [[]];
function prepare(prefix: Word, remaining: number) {
  if (remaining === 0) return;
  for (const move of MOVES) {
    // Canonical adjacent same-face runs: QTM2 retained as two positive turns.
    const next = [...prefix, move];
    if (simplify(next).length !== next.length) continue;
    const prior = prefix.at(-1);
    if (prior?.face === move.face && (prior.inverse || move.inverse || prefix.at(-2)?.face === move.face)) continue;
    preparations.push(next); prepare(next, remaining - 1);
  }
}
prepare([], LIMITS.preparationDepthQtm);
const prepUnique = [...new Map(preparations.map(word => { const e = effect(word); return [e.destination.join('') + ':' + e.twist.join(''), word] as const; })).values()];
let seed = 0x6c6f6361;
const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
function arbitraryLegalState(): CubeState {
  const cubieAt = [0, 1, 2, 3, 4, 5, 6, 7] as Eight<number>;
  for (let i = 6; i > 0; i--) { const j = random() % (i + 1); [cubieAt[i], cubieAt[j]] = [cubieAt[j], cubieAt[i]]; }
  const orientationAt = [0, 0, 0, 0, 0, 0, 0, 0] as Eight<Orientation>;
  for (let i = 0; i < 6; i++) orientationAt[i] = (random() % 3) as Orientation;
  orientationAt[6] = mod3(-orientationAt.reduce<number>((a,b) => a+b, 0));
  const state = { cubieAt, orientationAt }; assertLegal(state); return state;
}
let conjugationCases = 0, arbitraryStateReplays = 0, nonPureGaugeCases = 0;
const relocationExamples = curated.slice(0, 0).map(fullRecord);
const relocationPairs = new Set<string>();
const relocationTable = new Map<string, { preparation: string; preparationQtm: number; sequence: string; qtm: number; sourceTwist: Eight<Orientation> }>();
let gaugeCounterexample: { preparation: string; sourceSequence: string; sequence: string; destination: number[]; naiveSourceTwist: number[]; actualSourceTwist: number[] } | null = null;
const verificationSources = [basics[3], pair, ...(cleanThree ? [cleanThree] : []), ...curated.slice(0, 12)];
for (const k of prepUnique) for (const s of verificationSources) {
  const ke = effect(k), se = effect(s.word), word = conjugate(k, s.word), ce = effect(word);
  assert.ok(s.expandedQtm + 2 * k.length <= LIMITS.expandedQtm);
  const kinv = ke.destination.map((_, target) => ke.destination.indexOf(target));
  const predicted: Effect = { destination: [...ce.destination] as Eight<number>, twist: [...ce.twist] as Eight<Orientation> };
  for (let p = 0; p < 8; p++) {
    const destination = kinv[se.destination[ke.destination[p]]];
    predicted.destination[p] = destination;
    predicted.twist[p] = mod3(ke.twist[p] + se.twist[ke.destination[p]] - ke.twist[destination]);
  }
  assert.deepEqual(predicted, ce);
  assert.deepEqual(support(ce), IDS.filter((_, p) => support(se).includes(IDS[ke.destination[p]])));
  if (!pure(se) && ce.twist.some((t, p) => t !== se.twist[ke.destination[p]])) {
    nonPureGaugeCases++;
    gaugeCounterexample ??= { preparation: format(k), sourceSequence: format(s.word), sequence: format(word), destination: ce.destination,
      naiveSourceTwist: IDS.map((_, p) => se.twist[ke.destination[p]]), actualSourceTwist: ce.twist };
  }
  const state = arbitraryLegalState();
  assert.deepEqual(execute(state, word), act(state, ce));
  assert.deepEqual(execute(state, word), act(state, predicted));
  assert.deepEqual(execute(state, word), execute(execute(execute(state, k), s.word), inverse(k)));
  arbitraryStateReplays++; conjugationCases++;
  if (s === pair) {
    relocationPairs.add(support(ce).join(''));
    const twistKey = ce.twist.join(''), previous = relocationTable.get(twistKey);
    if (!previous || k.length < previous.preparationQtm || (k.length === previous.preparationQtm && format(k) < previous.preparation)) {
      relocationTable.set(twistKey, { preparation: format(k), preparationQtm: k.length, sequence: format(word), qtm: word.length, sourceTwist: ce.twist });
    }
    if (k.length > 0 && relocationExamples.length < 5 && !relocationExamples.some(c => c.support.join('') === support(ce).join(''))) {
      relocationExamples.push(fullRecord({ expression: `${format(k)} (${s.expression}) (${format(inverse(k))})`, word, expandedQtm: s.expandedQtm + 2 * k.length, depth: s.depth, family: 'preparation-conjugate' }));
    }
  }
}
const baseSummary: Record<string, number> = {};
for (const b of basics) { const label = fullRecord(b).permutationCycleType.join('+') || 'identity'; baseSummary[label] = (baseSummary[label] ?? 0) + 1; }
const counterexample = basics.find(c => c.expression === '[F,U]'); assert.ok(counterexample);
const witness = trajectory(counterexample.word);
const result = {
  provenance: { script: 'scripts/research/commutators.ts', ruleSource: 'src/cube.ts', toolkit: 'scripts/research/algebra.ts', command: 'node --experimental-strip-types scripts/research/commutators.ts',
    conventions: { execution: 'left-to-right', commutator: 'X Y inverse(X) inverse(Y)', conjugate: 'K S inverse(K)', orientation: 'SOURCE-indexed; deposited at destination[source]', qtm: 'quarter and inverse=1; half-turn=2; qtm is simplified, expandedQtm is recursive template cost before cancellations', htm: 'each nontrivial same-face power counts one' },
    limits: LIMITS, randomSeed: '0x6c6f6361', candidateStorageAccounting: '512 bytes per retained group key + 4096 bytes per retained candidate/frontier entry; streaming enumeration; cap independently enforced; excludes output serialization and Node runtime',
    completeness: 'Exhaustive only for basic81, its bounded powers, [basic-power,face-power] both orders, [basic,basic], [[basic,face-power],face-power] both orders, and bounded powers of [basic,face-power]. Not all words/nested commutators <=24.',
  },
  search: { cutoff, completedDeclaredFamilies: cutoff === null, replayedCandidates: replayed, uniqueFullElements: seen.size, maximumEstimatedCandidateStorageBytes, counters, classificationUniqueElements: Object.fromEntries(Object.entries(classification).sort()), basePermutationTypes: baseSummary },
  basic81: basics.map(fullRecord), curatedUnique: curated.map(fullRecord),
  highlights: { pairTwist: fullRecord(pair), cleanThreeCycle: cleanThree ? fullRecord(cleanThree) : null,
    tutorialPositionCycle: fullRecord(tutorialPosition), tutorialPairTwist: fullRecord(tutorialTwist),
    cleanTransposition: selected.has('clean-transposition') ? fullRecord(selected.get('clean-transposition')![0]) : null,
    noTranspositionReason: 'Every commutator is even under permutation sign; powers, nested commutators, and conjugates remain even. A single transposition is odd, irrespective of corner twists.',
    commutatorCounterexample: fullRecord(counterexample),
    levelOneCounterexample: { explanation: 'G is on F only (one positive coordinate), yet [F,U] swaps it with E. F is on U only and is net fixed, yet its cubie leaves F at an intermediate prefix. Net fixed is not temporarily untouched.',
      positiveCoordinateLevels: IDS.map((id, p) => ({ id, position: POSITIONS[p], level: POSITIONS[p].filter(v => v > 0).length })),
      prefixes: witness.prefixes.map((state, i) => ({ afterQtm: i, cubieAt: state.cubieAt.map(p => IDS[p]), orientationAt: state.orientationAt })),
    },
  },
  conjugation: { formula: "p' = k^-1(s(k(p))); t'(p) = tK(p) + tS(k(p)) - tK(p') (mod 3)",
    supportFormula: 'support(K S K^-1) = k^-1(support(S)); NOT k(support(S)), because chronological execution is left-to-right',
    arbitraryLegalStateMethod: 'Independent shuffle of seven cubies; six independent twists, seventh forced by sum=0; H fixed. Each case replayed with official execute on a fresh deterministic state.',
    preparationWords: prepUnique.length, maximumPreparationQtm: LIMITS.preparationDepthQtm, conjugationCases, arbitraryStateReplays, nonPureGaugeCases,
    gaugeCounterexample,
    pairSupportRelocations: [...relocationPairs].sort(), relocationExamples,
    pairRelocationTable: [...relocationTable.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, entry]) => entry),
  },
};
const output = fileURLToPath(new URL('../../research/commutators.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../../research/', import.meta.url)), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, replayed, unique: seen.size, cutoff, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)), pairTwist: result.highlights.pairTwist.expression, cleanThreeCycle: result.highlights.cleanThreeCycle?.expression ?? null, conjugationCases }));
