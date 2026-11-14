export const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type CubieId = typeof IDS[number];
export type Orientation = 0 | 1 | 2;
export type Face = 'F' | 'U' | 'R';
export type Vector = readonly [number, number, number];
export type Eight<T> = [T, T, T, T, T, T, T, T];
export interface CubeState {
  cubieAt: Eight<number>;
  orientationAt: Eight<Orientation>;
}
export interface Move { face: Face; inverse: boolean }
export interface MoveTable {
  destination: Eight<number>;
  delta: Eight<Orientation>;
}
export const POSITIONS: readonly Vector[] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
];
export const FACE_AXIS: Record<Face, number> = { F: 2, U: 1, R: 0 };
export const mod3 = (n: number): Orientation => ((n % 3 + 3) % 3) as Orientation;
export const sameVector = (a: Vector, b: Vector) => a.every((v, i) => v === b[i]);

// All local frames have determinant -1. Moving between them can only induce
// a cyclic permutation, never a reflection of a physical corner's colors.
export const FRAMES: readonly (readonly Vector[])[] = POSITIONS.map(([x, y, z]) => {
  const nx: Vector = [x, 0, 0], ny: Vector = [0, y, 0], nz: Vector = [0, 0, z];
  return x * y * z > 0 ? [ny, nx, nz] : [ny, nz, nx];
});

// Clockwise quarter turn viewed directly at the positive-axis face.
export function rotate(v: Vector, face: Face): Vector {
  const [x, y, z] = v;
  switch (face) {
    case 'F': return [y, -x, z];
    case 'U': return [-z, y, x];
    case 'R': return [x, z, -y];
  }
}

function deriveMove(face: Face): MoveTable {
  const destination = IDS.map((_, i) => i) as Eight<number>;
  const delta = IDS.map(() => 0) as Eight<Orientation>;
  POSITIONS.forEach((position, source) => {
    if (position[FACE_AXIS[face]] !== 1) return;
    const target = POSITIONS.findIndex(p => sameVector(p, rotate(position, face)));
    destination[source] = target;
    delta[source] = FRAMES[target].findIndex(n => sameVector(n, rotate(FRAMES[source][0], face))) as Orientation;
    FRAMES[source].forEach((normal, k) => {
      if (!sameVector(rotate(normal, face), FRAMES[target][mod3(k + delta[source])])) {
        throw new Error('Corner handedness mismatch');
      }
    });
  });
  return { destination, delta };
}
export const TABLES: Record<Face, MoveTable> = {
  F: deriveMove('F'), U: deriveMove('U'), R: deriveMove('R'),
};
export function solvedState(): CubeState {
  return { cubieAt: [0, 1, 2, 3, 4, 5, 6, 7], orientationAt: [0, 0, 0, 0, 0, 0, 0, 0] };
}
export function applyMove(state: CubeState, move: Move): CubeState {
  let next = state;
  const table = TABLES[move.face];
  for (let turn = 0; turn < (move.inverse ? 3 : 1); turn++) {
    const result = solvedState();
    for (let p = 0; p < 8; p++) {
      const target = table.destination[p];
      result.cubieAt[target] = next.cubieAt[p];
      result.orientationAt[target] = mod3(next.orientationAt[p] + table.delta[p]);
    }
    next = result;
  }
  return next;
}
export const isSolved = (s: CubeState) => s.cubieAt.every((id, p) => id === p && s.orientationAt[p] === 0);
export function assertLegal(s: CubeState): void {
  if (s.cubieAt.length !== 8 || new Set(s.cubieAt).size !== 8 ||
      s.cubieAt.some(id => !Number.isInteger(id) || id < 0 || id > 7) ||
      s.orientationAt.length !== 8 || s.orientationAt.some(o => ![0, 1, 2].includes(o)) ||
      s.cubieAt[7] !== 7 || s.orientationAt[7] !== 0 ||
      s.orientationAt.reduce<number>((sum, o) => sum + o, 0) % 3 !== 0) {
    throw new Error('Illegal fixed-reference cube state');
  }
}
export const notation = (move: Move) => move.face + (move.inverse ? '′' : '');

export const COLORS = {
  red: '#e65765', white: '#f1f3f4', blue: '#628fca',
  yellow: '#ead76b', orange: '#efa55b', green: '#83ae8c',
};
export type Color = keyof typeof COLORS;
export function normalColor([x, y, z]: Vector): Color {
  if (x) return x > 0 ? 'blue' : 'green';
  if (y) return y > 0 ? 'white' : 'yellow';
  return z > 0 ? 'red' : 'orange';
}
export const CUBIE_COLORS = FRAMES.map(frame => frame.map(normalColor));
