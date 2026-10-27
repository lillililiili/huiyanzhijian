import type { Rule } from './api';

// String-only formatting: retain every non-zero decimal digit in the source value.
export function compactDecimal(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  if (!/^[+-]?\d+\.\d+$/.test(value)) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

export function detectionLimit(rule: Rule | undefined, unit: string): string {
  const c = rule?.comparison;
  if (!c) return '仅采集';
  if (c.operator === 'GE' && c.lower != null) return `≥ ${compactDecimal(c.lower)} ${unit}`;
  if (c.operator === 'LE' && c.upper != null) return `≤ ${compactDecimal(c.upper)} ${unit}`;
  if (c.lower != null && c.upper != null) return `${compactDecimal(c.lower)} – ${compactDecimal(c.upper)} ${unit}`;
  return '规则待核对';
}
