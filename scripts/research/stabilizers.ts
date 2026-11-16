import { readFileSync, writeFileSync } from 'node:fs';
import { IDS, solvedState, type Move, type Orientation } from '../../src/cube.ts';
import { MOVES, type Effect, type Word, effect, execute, inverse, simplify, format, key, record, parse, pure, cycles } from './algebra.ts';

// Research only. The only primitive actions come from cube.ts via algebra.ts.
// Each experiment has independent wall-clock and candidate bounds; run with
// node --max-old-space-size=64 --max-semi-space-size=4 --experimental-strip-types scripts/research/stabilizers.ts
const chain = [6, 5, 3, 4, 1, 2, 0];
const factorial = [1, 1, 2, 6, 24, 120, 720, 5040];
const power3 = [1, 3, 9, 27, 81, 243, 729];
const identity = effect([]);
const compose = (a: Effect, b: Effect): Effect => ({
  destination: a.destination.map(p => b.destination[p]) as Effect['destination'],
  twist: a.destination.map((p, i) => (a.twist[i] + b.twist[p]) % 3) as Effect['twist'],
});
const effectKey = (e: Effect) => e.destination.join('') + ':' + e.twist.join('');
const stabilizes = (e: Effect, prefix: number[]) => prefix.every(p => e.destination[p] === p && e.twist[p] === 0);
const point = (e: Effect, p: number, o: number) => 3 * e.destination[p] + (o + e.twist[p]) % 3;
type Macro = { word: Word; e: Effect };
const macro = (word: Word): Macro => { word = simplify(word); return { word, e: effect(word) }; };
const sortMacro = (a: Macro, b: Macro) => a.word.length - b.word.length || format(a.word).localeCompare(format(b.word));
const bounds = { maxQTM: 8, localityCandidateCap: 500000, localityTimeMs: 60000, retainedPerStage: 128, catalogCap: 256, chainCandidateCap: 10000, chainTimeMs: 120000, maxOrbit: 21, maxClosureStates: 174960, heapMiB: 64, semiSpaceMiB: 4, processLimitMiB: 256 };
const start = Date.now();
const localityStart = Date.now();
const pools: Map<string, Macro>[] = chain.map(() => new Map());
const catalog = new Map<string, Macro>();
let localityCandidates = 0, localityComplete = true;
const primitive = MOVES.map(m => macro([m]));
function retain(m: Macro) {
  if (!m.word.length) return;
  let level = 0;
  while (level < chain.length && stabilizes(m.e, [chain[level]])) level++;
  for (let i = 1; i <= level && i < chain.length; i++) {
    const pool = pools[i], k = effectKey(m.e), old = pool.get(k);
    if (old && sortMacro(old, m) <= 0) continue;
    pool.set(k, m);
    if (pool.size > bounds.retainedPerStage) {
      const worst = [...pool.entries()].sort((a, b) => sortMacro(a[1], b[1])).at(-1)!;
      pool.delete(worst[0]);
    }
  }
  const c = cycles(m.e), small = pure(m.e) || (c.length === 1 && c[0].length <= 3);
  if (small) {
    const k = effectKey(m.e), old = catalog.get(k);
    if (!old || sortMacro(m, old) < 0) catalog.set(k, m);
    if (catalog.size > bounds.catalogCap) {
      const worst = [...catalog.entries()].sort((a, b) => sortMacro(a[1], b[1])).at(-1)!;
      catalog.delete(worst[0]);
    }
  }
}
// Canonical face runs: a face appears with power 1, -1, or 2; adjacent
// runs use distinct faces. This enumerates every reduced word of QTM<=8.
function visit(word: Word, e: Effect, lastFace: string) {
  if (word.length) { localityCandidates++; retain({ word, e }); }
  if (localityCandidates >= bounds.localityCandidateCap || Date.now() - localityStart > bounds.localityTimeMs) { localityComplete = false; return; }
  for (const face of ['F', 'U', 'R'] as const) {
    if (face === lastFace) continue;
    for (const power of [1, 3, 2]) {
      const moves: Move[] = power === 2 ? [{ face, inverse: false }, { face, inverse: false }] : [{ face, inverse: power === 3 }];
      if (word.length + moves.length > bounds.maxQTM) continue;
      let next = e;
      for (const m of moves) next = compose(next, primitive.find(p => p.word[0].face === m.face && p.word[0].inverse === m.inverse)!.e);
      visit([...word, ...moves], next, face);
      if (!localityComplete) return;
    }
  }
}
visit([], identity, '');
const locality = { candidates: localityCandidates, completeThroughQTM8: localityComplete, retainedByStage: pools.map(p => p.size), retainedCatalog: catalog.size };

const chainStart = Date.now();
function guard() { if (Date.now() - chainStart > bounds.chainTimeMs) throw new Error('Chain time bound reached'); }
// Full-state membership, not permutation-only deduplication. Local code is
// permutation rank * 3^(n-1) + source-twist rank. Sum twists determines last.
function encode(e: Effect, slots: number[]) {
  let p = 0, o = 0, scale = 1;
  for (let i = 0; i < slots.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < slots.length; j++) if (e.destination[slots[j]] < e.destination[slots[i]]) smaller++;
    p += smaller * factorial[slots.length - 1 - i];
    if (i + 1 < slots.length) { o += e.twist[slots[i]] * scale; scale *= 3; }
  }
  return p * power3[Math.max(0, slots.length - 1)] + o;
}
function decode(code: number, slots: number[]): Effect {
  const n = slots.length, orientCount = power3[Math.max(0, n - 1)];
  let rank = Math.floor(code / orientCount), orientation = code % orientCount, sum = 0;
  const available = [...slots], d = [...identity.destination], t = [...identity.twist];
  for (let i = 0; i < n; i++) {
    const f = factorial[n - 1 - i], index = Math.floor(rank / f);
    rank %= f; d[slots[i]] = available.splice(index, 1)[0];
    // Both radix-3 branches are integers in 0..2; no physical rule is inferred here.
    t[slots[i]] = (i + 1 < n ? orientation % 3 : (3 - sum % 3) % 3) as Orientation;
    orientation = Math.floor(orientation / 3); sum += t[slots[i]];
  }
  return { destination: d as Effect['destination'], twist: t as Effect['twist'] };
}
function closure(gens: Macro[], slots: number[]) {
  const total = factorial[slots.length] * power3[Math.max(0, slots.length - 1)];
  if (total > bounds.maxClosureStates) throw new Error('Closure memory/state cap');
  const seen = new Uint8Array(total), queue = new Uint32Array(total);
  seen[0] = 1; let begin = 0, end = 1;
  while (begin < end) {
    if (!(begin % 1024)) guard();
    const e = decode(queue[begin++], slots);
    for (const g of gens) {
      const code = encode(compose(e, g.e), slots);
      if (!seen[code]) { seen[code] = 1; queue[end++] = code; }
    }
  }
  return { seen, count: end };
}
function orbit(gens: Macro[], base: number) {
  // Short-label traversal of at most 21 corner states, with QTM edge costs.
  // Boundary simplification makes this a heuristic, not a shortest-word claim.
  const trans: (Macro | undefined)[] = Array(24), done = new Set<number>();
  trans[base * 3] = { word: [], e: identity };
  while (true) {
    guard();
    let x = -1;
    for (let p = 0; p < 21; p++) if (trans[p] && !done.has(p) && (x < 0 || trans[p]!.word.length < trans[x]!.word.length)) x = p;
    if (x < 0) break;
    done.add(x);
    for (const g of gens) {
      const y = point(g.e, Math.floor(x / 3), x % 3), w = simplify([...trans[x]!.word, ...g.word]);
      if (!trans[y] || w.length < trans[y]!.word.length) trans[y] = { word: w, e: compose(trans[x]!.e, g.e) };
    }
  }
  return trans;
}
function protectedRecord(word: Word, type: string, explanation: string, prefix: number[]) {
  const r = record(word, type, explanation), displaced = new Set<number>();
  let state = solvedState(), maximum = 0;
  for (const move of simplify(word)) {
    state = execute(state, [move]);
    const disturbed = prefix.filter(p => state.cubieAt[p] !== p || state.orientationAt[p] !== 0);
    maximum = Math.max(maximum, disturbed.length);
    for (const p of disturbed) displaced.add(p);
  }
  return { ...r, temporaryDisplacedProtected: [...displaced].map(p => IDS[p]), maxSimultaneousDisplacedProtected: maximum };
}
let gens = primitive;
const stages: unknown[] = [];
const allRecords: { sequence: string; destination: number[]; orientation: number[] }[] = [];
let chainCandidates = 0;
for (let stage = 0; stage < chain.length; stage++) {
  guard();
  const base = chain[stage], prefix = chain.slice(0, stage), remaining = IDS.map((_, i) => i).filter(i => i < 7 && !prefix.includes(i));
  const trans = orbit(gens, base), entries = trans.flatMap((t, x) => t ? [{ x, t }] : []);
  const expectedOrbit = remaining.length === 1 ? 1 : 3 * remaining.length;
  if (entries.length !== expectedOrbit) throw new Error(`Incomplete orbit stage ${stage}: ${entries.length}/${expectedOrbit}`);
  const transRecords = entries.map(({ x, t }) => ({ cornerState: [IDS[Math.floor(x / 3)], x % 3], ...protectedRecord(t.word, 'transversal', `Maps ${IDS[base]} orientation 0 to this corner state; fixes ${prefix.map(i => IDS[i]).join(',') || 'none'} at macro boundary`, prefix) }));
  const genRecords = gens.map(g => protectedRecord(g.word, 'stabilizer-generator', `Fixes full states of ${prefix.map(i => IDS[i]).join(',') || 'no prior slots'} at macro boundary`, prefix));
  allRecords.push(...transRecords, ...genRecords);
  let nextOrder = 1, nextGens: Macro[] = [], candidateCount = 0;
  if (stage + 1 < chain.length) {
    const nextPrefix = chain.slice(0, stage + 1), nextSlots = remaining.filter(i => i !== base), candidates = new Map(pools[stage + 1]);
    for (const { x, t } of entries) for (const g of gens) {
      const y = point(g.e, Math.floor(x / 3), x % 3);
      const s = macro([...t.word, ...g.word, ...inverse(trans[y]!.word)]);
      if (!stabilizes(s.e, nextPrefix)) throw new Error('Schreier protection failure');
      if (!s.word.length) continue;
      const k = effectKey(s.e), old = candidates.get(k);
      if (!old || sortMacro(s, old) < 0) candidates.set(k, s);
      chainCandidates++; if (chainCandidates > bounds.chainCandidateCap) throw new Error('Schreier candidate cap');
    }
    candidateCount = candidates.size;
    let subgroup = closure([], nextSlots);
    const target = factorial[nextSlots.length] * power3[Math.max(0, nextSlots.length - 1)];
    for (const s of [...candidates.values()].sort(sortMacro)) {
      if (subgroup.seen[encode(s.e, nextSlots)]) continue;
      nextGens.push(s); subgroup = closure(nextGens, nextSlots);
      if (subgroup.count === target) break;
    }
    nextOrder = subgroup.count;
    if (nextOrder !== target) throw new Error(`Incomplete generated stabilizer ${nextOrder}/${target}`);
    // Include inverses in the next finite-orbit search, dedup full effects.
    const symmetric = new Map<string, Macro>();
    for (const g of nextGens) for (const h of [g, macro(inverse(g.word))]) symmetric.set(effectKey(h.e), h);
    nextGens = [...symmetric.values()].sort(sortMacro);
  }
  stages.push({ stage, base: IDS[base], protected: prefix.map(i => IDS[i]), remaining: remaining.map(i => IDS[i]), expectedGroupOrder: factorial[remaining.length] * power3[Math.max(0, remaining.length - 1)], orbitSize: entries.length, expectedOrbit, generatorCount: gens.length, generatorLengths: gens.map(g => g.word.length), maxCorrectionQTM: Math.max(...entries.map(e => e.t.word.length)), meanCorrectionQTM: entries.reduce((s, e) => s + e.t.word.length, 0) / entries.length, schreierCandidates: candidateCount, generatedNextStabilizerOrder: nextOrder, generators: genRecords, transversals: transRecords });
  gens = nextGens;
}
const catalogRecords = [...catalog.values()].sort(sortMacro).map(m => record(m.word, pure(m.e) ? 'pure-twist' : 'local-permutation', 'Bounded QTM8 locality search; twists are source-indexed'));
allRecords.push(...catalogRecords);
// Every serialized full effect is replayed through official applyMove, independently
// of the induced composition used during finite-orbit and subgroup calculations.
let replayed = 0;
for (const r of allRecords) {
  const actual = effect(parse(r.sequence));
  if (actual.destination.join() !== r.destination.join() || actual.twist.join() !== r.orientation.join()) throw new Error('Official replay mismatch');
  replayed++;
}
const stageData = stages as { transversals: { cornerState: (string | number)[]; sequence: string; length: number }[]; base: string; protected: string[] }[];
let seed = 0x51ab1e, solvedSamples = 0, totalQTM = 0, maxQTM = 0;
const sampleCosts: number[] = [];
for (let trial = 0; trial < 200; trial++) {
  let state = solvedState();
  for (let i = 0; i < 40 + trial % 2; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; state = execute(state, [MOVES[(seed >>> 16) % MOVES.length]]); }
  let cost = 0;
  for (const stage of stageData) {
    const id = IDS.indexOf(stage.base as typeof IDS[number]), slot = state.cubieAt.indexOf(id), o = state.orientationAt[slot];
    const t = stage.transversals.find(t => t.cornerState[0] === IDS[slot] && t.cornerState[1] === o)!;
    const correction = inverse(parse(t.sequence));
    state = execute(state, correction); cost += correction.length;
    for (const p of [...stage.protected, stage.base]) { const index = IDS.indexOf(p as typeof IDS[number]); if (state.cubieAt[index] !== index || state.orientationAt[index] !== 0) throw new Error('Sample lost protected slot'); }
  }
  if (key(state) !== key(solvedState())) throw new Error('Sample not solved');
  solvedSamples++; totalQTM += cost; maxQTM = Math.max(maxQTM, cost); sampleCosts.push(cost);
}
sampleCosts.sort((a,b) => a-b);
// Linux ru_maxrss may include the tool launcher's pre-exec high-water mark.
// /proc reports this executable's own resident high-water mark.
const peakRSSMiB = Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync('/proc/self/status', 'utf8'))![1]) / 1024;
if (peakRSSMiB > bounds.processLimitMiB) throw new Error(`Resident memory cap exceeded: ${peakRSSMiB} MiB`);
const result = { convention: 'Chronological left-to-right words; QTM primary, F2 costs 2; orientation arrays source-indexed; H fixed throughout', bounds, locality, chain: { complete: true, generatedCandidates: chainCandidates, orbitProduct: (stages as { orbitSize: number }[]).reduce((a,s) => a*s.orbitSize,1), stages }, catalog: catalogRecords, replay: { records: replayed, officialModel: 'src/cube.ts applyMove via algebra.effect', allPassed: true }, solvingSamples: { seed: '0x51ab1e', count: solvedSamples, scrambleLengths: [40,41], generator: 'LCG 1664525*x+1013904223; MOVES[(seed >>> 16) % 6]', distribution: 'Not uniform; deterministic random walks only; alternate parity', meanQTM: totalQTM/solvedSamples, maxQTM, medianQTM: sampleCosts[100], p95QTM: sampleCosts[190] } };
writeFileSync(new URL('../../research/stabilizers.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ locality, stages: (stages as Record<string, unknown>[]).map(({ generators, transversals, ...s }) => s), replayed, solvingSamples: result.solvingSamples, elapsedMs: Date.now() - start, peakRSSMiB, memoryMeasurement: 'Linux /proc/self/status VmHWM' }, null, 2));
