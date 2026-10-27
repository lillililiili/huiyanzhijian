import type { EChartsOption } from 'echarts';
import { labelTime, type Measurement, type Rule } from './api';
import { timeTick } from './displayTime';
import { compactDecimal } from './detectionDisplay';

export function detectionTrendOption(points: Measurement[], unit: string, axis: string, rule?: Rule): EChartsOption {
  const subsecond = points.length > 1 && Math.abs(Date.parse(points[points.length - 1].raw_payload.sample_time) - Date.parse(points[0].raw_payload.sample_time)) < 60000;
  const comparison = rule?.comparison;
  const boundaries: { name: string; yAxis: number }[] = [];
  if (comparison) {
    if (comparison.operator !== 'LE' && comparison.lower != null && Number.isFinite(Number(comparison.lower))) boundaries.push({ name: `规则下限 ${compactDecimal(comparison.lower)} ${unit}`, yAxis: Number(comparison.lower) });
    if (comparison.operator !== 'GE' && comparison.upper != null && Number.isFinite(Number(comparison.upper))) boundaries.push({ name: `规则上限 ${compactDecimal(comparison.upper)} ${unit}`, yAxis: Number(comparison.upper) });
  }
  const values = points.map(r => r.raw_payload.data_status === 'VALID' && r.value !== null && Number.isFinite(Number(r.value)) ? Number(r.value) : null);
  const extent = [...values.filter((v): v is number => v !== null), ...boundaries.map(b => b.yAxis)];
  const low = extent.reduce((a, b) => Math.min(a, b), Infinity), high = extent.reduce((a, b) => Math.max(a, b), -Infinity);
  const padding = Math.max((high - low) * .15, Math.abs(high) * .05, .01);
  const rawStep = (high - low + padding * 2) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].find(n => n * magnitude >= rawStep)! * magnitude;
  const axisMin = Math.floor((low - padding) / step) * step;
  const axisMax = Math.ceil((high + padding) / step) * step;
  const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return {
    animation: false,
    color: ['#2569c6'],
    grid: { left: 54, right: 24, bottom: 94, top: 30 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e3eaf3', padding: [12, 14], textStyle: { color: '#233f61', fontSize: 12 }, axisPointer: { type: 'line', lineStyle: { color: '#9cb6d8', type: 'dashed' } }, formatter: (items: any) => {
      const point = points[items?.[0]?.dataIndex];
      if (!point) return '';
      const position = point.raw_payload.position_m == null ? '位置未知' : `${point.raw_payload.position_m} m（未验证）`;
      return `${escape(labelTime(point.raw_payload.sample_time))}<br/>${escape(position)}<br/><b>${escape(point.value ?? '无效 / 缺测')} ${escape(point.unit)}</b><br/>${point.quality_result === 'FAIL' ? '超限' : point.quality_result === 'PASS' ? '符合当前规则' : '未判定'} · 点击查看原始记录`;
    } },
    xAxis: { type: 'category', boundaryGap: false, data: points.map(r => axis === 'time' ? r.raw_payload.sample_time : r.raw_payload.position_m ?? '位置未知'), name: axis === 'time' ? '北京时间' : '来源米数（未验证）', nameLocation: 'middle', nameGap: 31, nameTextStyle: { color: '#8190a5', fontSize: 11 }, axisLine: { lineStyle: { color: '#dce5f0' } }, axisTick: { show: false }, axisLabel: { color: '#7a8ba2', fontSize: 11, hideOverlap: true, formatter: (v: string) => axis === 'time' ? timeTick(v, subsecond) : compactDecimal(v) } },
    yAxis: { type: 'value', name: unit, scale: true, ...(extent.length ? { min: low >= 0 ? Math.max(0, axisMin) : axisMin, max: axisMax, interval: step } : {}), splitNumber: 4, nameTextStyle: { color: '#8190a5' }, axisLabel: { color: '#7a8ba2', fontSize: 11 }, splitLine: { lineStyle: { color: '#e9eff6', type: 'dashed' } } },
    dataZoom: [
      { id: 'review-inside', type: 'inside', filterMode: 'none' },
      { id: 'review-global', type: 'slider', filterMode: 'none', height: 30, bottom: 7, showDetail: false, borderColor: '#e0e8f3', backgroundColor: '#f5f8fc', fillerColor: 'rgba(37,105,198,.09)', handleSize: '100%', handleStyle: { color: '#fff', borderColor: '#82a8d8' }, moveHandleSize: 5, moveHandleStyle: { color: '#b0c5e1' }, dataBackground: { lineStyle: { color: '#adc4e3', width: 1 }, areaStyle: { color: '#e3ecf8', opacity: 1 } }, selectedDataBackground: { lineStyle: { color: '#6c98cf', width: 1 }, areaStyle: { color: '#d4e3f7', opacity: 1 } } }
    ],
    series: [{ type: 'line', smooth: false, connectNulls: false, showSymbol: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5 }, itemStyle: { borderColor: '#fff', borderWidth: 1.5 }, areaStyle: { origin: 'start', color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(56,128,225,.24)' }, { offset: 1, color: 'rgba(56,128,225,.025)' }] } }, data: values.map((value, i) => ({ value, ...(value !== null && points[i].quality_result === 'FAIL' ? { itemStyle: { color: '#df5966', borderColor: '#fff' }, symbolSize: 7 } : {}) })), markLine: { silent: true, symbol: 'none', lineStyle: { color: '#da8290', type: 'dashed', width: 1 }, label: { position: 'insideEndTop', formatter: '{b}', color: '#b56976', fontSize: 11 }, data: boundaries } }]
  };
}
