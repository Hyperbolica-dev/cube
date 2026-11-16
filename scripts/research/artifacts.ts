import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(isObject(value), `Expected a JSON object: ${path}`);
  return value;
}
export interface StoredOperation {
  sequence: string;
  destination: number[];
  orientation?: number[];
  sourceTwist?: number[];
}
export interface TransversalRow extends StoredOperation { length: number; cornerState: [string, number] }
export interface StabilizerStage { base: string; protected: string[]; orbitSize: number; transversals: TransversalRow[] }
export function isOperation(value: unknown): value is StoredOperation {
  return isObject(value) && typeof value.sequence === 'string' && Array.isArray(value.destination) && value.destination.length === 8 && value.destination.every(p => Number.isInteger(p) && p >= 0 && p < 8) &&
    (value.orientation === undefined || (Array.isArray(value.orientation) && value.orientation.length === 8 && value.orientation.every(o => [0, 1, 2].includes(o)))) &&
    (value.sourceTwist === undefined || (Array.isArray(value.sourceTwist) && value.sourceTwist.length === 8 && value.sourceTwist.every(o => [0, 1, 2].includes(o))));
}
export function isStage(value: unknown): value is StabilizerStage {
  if (!isObject(value) || typeof value.base !== 'string' || !Array.isArray(value.protected) || !value.protected.every(p => typeof p === 'string') ||
      typeof value.orbitSize !== 'number' || !Array.isArray(value.transversals)) return false;
  return value.transversals.every(row => isOperation(row) && 'length' in row && typeof row.length === 'number' &&
    'cornerState' in row && Array.isArray(row.cornerState) && row.cornerState.length === 2 && typeof row.cornerState[0] === 'string' && [0, 1, 2].includes(row.cornerState[1]));
}
