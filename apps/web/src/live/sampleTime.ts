import type { Measurement } from './api';

// Compare source timestamps at microsecond precision; receipt order is only a tie breaker.
function micros(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] || '';
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6) || '0');
}
export function compareSampleTime(a: Measurement, b: Measurement): number {
  const x=micros(a.raw_payload.sample_time), y=micros(b.raw_payload.sample_time);
  return x<y?-1:x>y?1:0;
}
export function sortBySampleTime(rows: Measurement[]): Measurement[] {
  return [...rows].sort((a,b)=>compareSampleTime(a,b) || String(a.ingest_order).localeCompare(String(b.ingest_order), 'en', { numeric: true }));
}
// ECharts uses numeric milliseconds; original fractional seconds stay intact in tooltips/details.
export function plotTime(value: string): number { return Number(micros(value))/1000; }
