// Presentation only: keep every fractional digit from the source timestamp.
// CSV/JSON exports continue using the original source strings.
export function labelTime(value?: string | null) {
  if (!value) return '—';
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return `${value}（时区未明确）`;
  const time = new Date(value);
  if (!Number.isFinite(time.valueOf())) return `${value}（时间格式无效）`;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(time);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}${fraction ? '.' + fraction : ''} 北京时间`;
}

export function timeTick(value: string, subsecond: boolean) {
  const full = labelTime(value);
  const time = full.match(/\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})(\.\d+)? 北京时间$/);
  return time ? time[1] + (subsecond ? (time[2] || '.000') : '') : value;
}
