import { mod3, type CubeState, type Eight, type Orientation } from '../../src/cube.ts';

// Same Lehmer/base-3 encoding used by the existing complete-state verifier.
export const PERMUTATIONS = 5040;
export const ORIENTATIONS = 729;
export const STATES = PERMUTATIONS * ORIENTATIONS;
const factorial = [1, 1, 2, 6, 24, 120, 720, 5040];
export function rankPermutation(permutation: number[]): number {
  let rank = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (permutation[j] < permutation[i]) smaller++;
    rank += smaller * factorial[6 - i];
  }
  return rank;
}
export function unrankPermutation(rank: number): Eight<number> {
  const remaining = [0, 1, 2, 3, 4, 5, 6], result = [];
  for (let i = 0; i < 7; i++) {
    const index = Math.floor(rank / factorial[6 - i]);
    rank %= factorial[6 - i];
    result.push(remaining.splice(index, 1)[0]);
  }
  return [...result, 7] as Eight<number>;
}
export function rankOrientation(orientation: Orientation[]): number {
  let rank = 0;
  for (let i = 5; i >= 0; i--) rank = rank * 3 + orientation[i];
  return rank;
}
export function unrankOrientation(rank: number): Eight<Orientation> {
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
export const rankState = (s: CubeState) => rankPermutation(s.cubieAt) * ORIENTATIONS + rankOrientation(s.orientationAt);
export function unrankState(code: number): CubeState {
  return { cubieAt: unrankPermutation(Math.floor(code / ORIENTATIONS)), orientationAt: unrankOrientation(code % ORIENTATIONS) };
}
