import type { Face } from './cube.ts';

export interface Point { x: number; y: number }
export interface Ring { center: Point; radius: number; direction: 1 | -1; label: string; color: string }
const r = 96;
const dx = Math.sqrt(3) * r / 2;
export const RINGS: Record<Face, Ring> = {
  F: { center: { x: 320 - dx, y: 190 }, radius: r, direction: 1, label: 'α · F', color: '#db758d' },
  U: { center: { x: 320 + dx, y: 190 }, radius: r, direction: 1, label: 'β · U', color: '#c4c6cd' },
  R: { center: { x: 320, y: 334 }, radius: r, direction: 1, label: 'γ · R', color: '#658cc4' },
};
export const SLOTS: readonly Point[] = [
  { x: 320, y: 238 },
  { x: 320 + dx, y: 286 },
  { x: 320 - dx, y: 286 },
  { x: 320, y: 430 },
  { x: 320, y: 142 },
  { x: 320 + 2 * dx, y: 142 },
  { x: 320 - 2 * dx, y: 142 },
  { x: 565, y: 430 },
];
// Angles of local frame index 0, clockwise in SVG screen coordinates.
export const BASE_ANGLES = [-30, 270, 150, 150, 30, 150, 150, 210];
export const angleAt = (p: Point, center: Point) => Math.atan2(p.y - center.y, p.x - center.x);
export function directedArc(from: Point, to: Point, ring: Ring, inverse: boolean): { start: number; sweep: number } {
  const start = angleAt(from, ring.center), end = angleAt(to, ring.center);
  const direction = ring.direction * (inverse ? -1 : 1);
  const tau = Math.PI * 2;
  return { start, sweep: direction > 0 ? (end - start + tau) % tau : -((start - end + tau) % tau) };
}
