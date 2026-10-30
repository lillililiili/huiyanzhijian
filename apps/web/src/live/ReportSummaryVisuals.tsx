import type { MetricSummaryItem } from './reportTypes';
import { names } from './api';

interface ReportSummaryVisualsProps {
  metrics: MetricSummaryItem[];
  sample?: boolean;
}

function numericValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricName(metric: MetricSummaryItem): string {
  return names[metric.metric_code] || metric.metric_code;
}

export function ReportSummaryVisuals({ metrics, sample = false }: ReportSummaryVisualsProps) {
  const passed = metrics.reduce((sum, metric) => sum + Math.max(0, metric.passed_samples || 0), 0);
  const failed = metrics.reduce((sum, metric) => sum + Math.max(0, metric.failed_samples || 0), 0);
  const judged = passed + failed;
  const passRate = judged > 0 ? (passed / judged) * 100 : null;
  const passRatio = passRate === null ? 0 : Math.min(100, Math.max(0, passRate));
  const datasetLabel = sample ? '样例数据' : '冻结汇总';

  if (metrics.length === 0) {
    return (
      <div className="report-visual-empty" role="status">
        当前报告快照没有可绘制的汇总统计，图表未生成。
      </div>
    );
  }

  return (
    <section className={`report-visuals ${sample ? 'is-sample' : ''}`} aria-label="报告统计图表">
      <div className="report-visuals-heading">
        <div>
          <h3>质量数据图表</h3>
          <p>从本报告统计快照生成；不使用其他任务或实时数据。</p>
        </div>
        <span className={`report-visuals-source ${sample ? 'sample' : ''}`}>{datasetLabel}</span>
      </div>

      <div className="report-visual-grid">
        <figure className="report-visual-card report-visual-card-composition">
          <figcaption>
            <strong>检测点判定构成</strong>
            <span>统计单位：点</span>
          </figcaption>
          <div className="report-donut-layout">
            <div
              className={`report-donut ${judged === 0 ? 'is-empty' : ''}`}
              style={{ background: judged > 0 ? `conic-gradient(#15845b 0 ${passRatio}%, #c84855 ${passRatio}% 100%)` : undefined }}
              role="img"
              aria-label={judged > 0 ? `符合 ${passed} 点，超限 ${failed} 点` : '没有可判定的检测点'}
            >
              <div className="report-donut-center">
                <strong>{passRate === null ? '—' : `${passRate.toFixed(1)}%`}</strong>
                <span>已判定点符合比例</span>
              </div>
            </div>
            <div className="report-visual-legend">
              <div><i className="pass" />符合 <strong>{passed}</strong></div>
              <div><i className="fail" />超限 <strong>{failed}</strong></div>
              <small>按检测项汇总；未判定点不计入分母</small>
            </div>
          </div>
        </figure>

        <figure className="report-visual-card report-visual-card-rates">
          <figcaption>
            <strong>各检测项合格率</strong>
            <span>百分比来自冻结统计</span>
          </figcaption>
          <div className="report-rate-list">
            {metrics.map(metric => {
              const rate = Number(metric.compliance_rate);
              const safeRate = Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0;
              return (
                <div className="report-rate-row" key={metric.metric_code}>
                  <div className="report-rate-label">
                    <span>{metricName(metric)}</span>
                    <strong>{Number.isFinite(rate) ? `${metric.compliance_rate}%` : '—'}</strong>
                  </div>
                  <div className="report-rate-track" aria-hidden="true">
                    <span style={{ width: `${safeRate}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </figure>

        <figure className="report-visual-card report-visual-card-range">
          <figcaption>
            <strong>统计值范围</strong>
            <span>各检测项独立量程；非时间趋势</span>
          </figcaption>
          <div className="report-range-list">
            {metrics.map(metric => {
              const min = numericValue(metric.min_value);
              const max = numericValue(metric.max_value);
              const average = numericValue(metric.avg_value);
              const hasRange = min !== null && max !== null;
              const span = hasRange ? max - min : 0;
              const averageInRange = average !== null && hasRange && average >= min && average <= max;
              const averagePosition = averageInRange && span > 0 ? ((average - min) / span) * 100 : 50;
              return (
                <div className="report-range-row" key={metric.metric_code}>
                  <div className="report-range-title">
                    <strong>{metricName(metric)}</strong>
                    <span>{metric.unit}</span>
                  </div>
                  {hasRange ? (
                    <>
                      <div className="report-range-track" role="img" aria-label={`${metricName(metric)}最小值 ${metric.min_value}，平均值 ${metric.avg_value ?? '未提供'}，最大值 ${metric.max_value} ${metric.unit}`}>
                        <span className="report-range-line" />
                        {averageInRange && <i className="report-range-average" style={{ left: `${averagePosition}%` }} />}
                      </div>
                      <div className="report-range-values">
                        <span>最小 {metric.min_value}</span>
                        <span>平均 {metric.avg_value ?? '—'}</span>
                        <span>最大 {metric.max_value}</span>
                      </div>
                    </>
                  ) : (
                    <div className="report-range-missing">快照未提供完整范围</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="report-range-footnote">图中标记仅展示每项统计最小值、平均值和最大值，不代表限值或合格边界。</div>
        </figure>
      </div>
    </section>
  );
}
