/** Tiny helpers for hand-written validators that collect every problem with its field path. */

export type Problems = string[];

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function str(p: Problems, path: string, v: unknown): string {
  if (typeof v === "string" && v.length > 0) return v;
  p.push(`${path}: expected a non-empty string`);
  return "";
}

export function strOrNull(p: Problems, path: string, v: unknown): string | null {
  if (v === null) return null;
  return str(p, path, v);
}

export function int(p: Problems, path: string, v: unknown, min: number): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= min) return v;
  p.push(`${path}: expected an integer >= ${min}`);
  return min;
}

export function oneOf<T extends string>(p: Problems, path: string, v: unknown, allowed: readonly T[]): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  p.push(`${path}: expected one of ${allowed.join(", ")}`);
  return allowed[0]!;
}

export function strArray(p: Problems, path: string, v: unknown): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [...v];
  p.push(`${path}: expected an array of strings`);
  return [];
}

export function isoTime(p: Problems, path: string, v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  p.push(`${path}: expected an ISO timestamp`);
  return "";
}
