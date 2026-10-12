export function isMediaId(value: string): boolean {
  return /^\d{1,20}$/.test(value) && /[1-9]/.test(value);
}

export function episodeParam(value: string | undefined, max: number): number | undefined {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : undefined;
}
