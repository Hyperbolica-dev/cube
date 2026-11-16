import { IDS, applyMove, solvedState, assertLegal, mod3, type CubeState, type Move, type Face, type Eight, type Orientation } from '../../src/cube.ts';

export type Word = Move[];
export const FACES: Face[] = ['F', 'U', 'R'];
export const MOVES: Move[] = FACES.flatMap(face => [{ face, inverse: false }, { face, inverse: true }]);
export function parse(text: string): Word {
  if (!text.trim()) return [];
  return text.trim().split(/\s+/).flatMap(token => {
    if (!/^[FUR](?:2|'|′)?$/.test(token)) throw new Error(`Invalid move: ${token}`);
    const move: Move = { face: token[0] as Face, inverse: /['′]/.test(token) };
    return token.endsWith('2') ? [move, { ...move }] : [move];
  });
}
export const inverse = (word: readonly Move[]): Word => [...word].reverse().map(m => ({ face: m.face, inverse: !m.inverse }));
export function simplify(word: readonly Move[]): Word {
  const stack: { face: Face; power: number }[] = [];
  for (const move of word) {
    const last = stack.at(-1);
    if (last?.face === move.face) {
      last.power = (last.power + (move.inverse ? 3 : 1)) % 4;
      if (last.power === 0) stack.pop();
    } else stack.push({ face: move.face, power: move.inverse ? 3 : 1 });
  }
  return stack.flatMap(({ face, power }) => power === 2 ? [{ face, inverse: false }, { face, inverse: false }] : [{ face, inverse: power === 3 }]);
}
export function format(word: readonly Move[]): string {
  const simple = simplify(word), tokens: string[] = [];
  for (let i = 0; i < simple.length; i++) {
    const move = simple[i];
    if (!move.inverse && simple[i + 1]?.face === move.face && !simple[i + 1].inverse) { tokens.push(move.face + '2'); i++; }
    else tokens.push(move.face + (move.inverse ? "'" : ''));
  }
  return tokens.join(' ');
}
// Words are executed LEFT TO RIGHT. [X,Y] means execute X,Y,X^-1,Y^-1.
export const commutator = (x: readonly Move[], y: readonly Move[]): Word => simplify([...x, ...y, ...inverse(x), ...inverse(y)]);
export const conjugate = (k: readonly Move[], s: readonly Move[]): Word => simplify([...k, ...s, ...inverse(k)]);
export function execute(state: CubeState, word: readonly Move[]): CubeState {
  for (const move of word) state = applyMove(state, move);
  return state;
}
export interface Effect {
  destination: Eight<number>;
  twist: Eight<Orientation>; // SOURCE-slot twist, deposited at destination[source].
}
export function effect(word: readonly Move[]): Effect {
  const state = execute(solvedState(), word);
  assertLegal(state);
  const destination = IDS.map((_, p) => state.cubieAt.indexOf(p)) as Eight<number>;
  return { destination, twist: destination.map(p => state.orientationAt[p]) as Eight<Orientation> };
}
// This is the induced action of an official-model word, not a separate cube rule.
export function act(state: CubeState, e: Effect): CubeState {
  const next = solvedState();
  for (let p = 0; p < 8; p++) {
    next.cubieAt[e.destination[p]] = state.cubieAt[p];
    next.orientationAt[e.destination[p]] = mod3(state.orientationAt[p] + e.twist[p]);
  }
  return next;
}
export const key = (state: CubeState) => state.cubieAt.join('') + ':' + state.orientationAt.join('');
export const support = (e: Effect) => IDS.filter((_, p) => e.destination[p] !== p || e.twist[p] !== 0);
export const fixed = (e: Effect) => IDS.filter((_, p) => e.destination[p] === p && e.twist[p] === 0);
export const pure = (e: Effect) => e.destination.every((p, source) => p === source);
export function cycles(e: Effect): string[][] {
  const seen = new Set<number>(), result: string[][] = [];
  for (let p = 0; p < 8; p++) {
    if (seen.has(p)) continue;
    const cycle: string[] = [];
    let q = p;
    do { seen.add(q); cycle.push(IDS[q]); q = e.destination[q]; } while (q !== p);
    if (cycle.length > 1) result.push(cycle);
  }
  return result;
}
export function order(e: Effect): number {
  let state = solvedState();
  for (let n = 1; n <= 1260; n++) {
    state = act(state, e);
    if (key(state) === '01234567:00000000') return n;
  }
  throw new Error('Order exceeded the declared finite bound');
}
export function record(word: readonly Move[], type: string, explanation: string) {
  const sequence = simplify(word), e = effect(sequence);
  return { sequence: format(sequence), length: sequence.length, halfTurnLength: format(sequence).split(' ').filter(Boolean).length,
    destination: e.destination, orientation: e.twist, permutation: cycles(e), support: support(e), fixed: fixed(e), order: order(e), type, explanation };
}
