import { useState, useMemo } from 'react';
import { PageTitle } from '../ui/PageTitle';
import { Panel } from '../ui/Panel';
import { Kpi } from '../ui/Kpi';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Note } from '../ui/Note';
import { Field } from '../ui/Field';
import { DataTable } from '../ui/DataTable';
import { HashLink } from '../ui/HashLink';
import { names, taskState, type Workspace, type Person } from './api';
import './analytics.css';

interface Props {
  data: Workspace;
  user: Person;
  refresh: () => Promise<void>;
}

export function AnalyticsLivePage({ data, refresh }: Props) {
  const [metricFilter, setMetricFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [specFilter, setSpecFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // 过滤符合条件的任务
  const filteredTasks = useMemo(() => {
    return data.tasks.filter(task => {
      if (metricFilter && task.metric_code !== metricFilter) return false;
      if (stateFilter && task.state !== stateFilter) return false;
      if (specFilter && task.specification_id !== specFilter) return false;
      if (keyword) {
        const text = [
          task.task_code,
          task.id,
          task.context_snapshot?.spool_code,
          task.context_snapshot?.external_code,
          task.current_spool_code,
          task.current_order_code
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(keyword.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [data.tasks, metricFilter, stateFilter, specFilter, keyword]);

  // 全局总体质量汇总统计
  const aggregate = useMemo(() => {
    let totalPlannedMeters = 0;
    let totalSamples = 0;
    let totalValid = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    const spoolSet = new Set<string>();

    for (const t of filteredTasks) {
      if (t.spool_id) spoolSet.add(t.spool_id);
      if (t.planned_length_m) totalPlannedMeters += Number(t.planned_length_m) || 0;
      const m = t.measurements;
      if (m) {
        totalSamples += m.total || 0;
        totalValid += m.valid || 0;
        totalPassed += m.passed || 0;
        totalFailed += m.failed || 0;
      }
    }

    const passRate = totalValid > 0 ? ((totalPassed / totalValid) * 100).toFixed(1) + ' %' : '—';

    return {
      taskCount: filteredTasks.length,
      spoolCount: spoolSet.size,
      totalPlannedMeters: totalPlannedMeters.toFixed(0),
      totalSamples,
      totalValid,
      totalPassed,
      totalFailed,
      passRate
    };
  }, [filteredTasks]);

  // 分项检测指标数据统计
  const metricStats = useMemo(() => {
    const calc = (code: string) => {
      const tasks = filteredTasks.filter(t => t.metric_code === code);
      let valid = 0;
      let passed = 0;
      let failed = 0;
      const means: number[] = [];
      let minVal: number | null = null;
      let maxVal: number | null = null;

      for (const t of tasks) {
        const m = t.measurements;
        if (m) {
          valid += m.valid || 0;
          passed += m.passed || 0;
          failed += m.failed || 0;
          if (m.mean != null && !isNaN(Number(m.mean))) means.push(Number(m.mean));
          if (m.minimum != null && !isNaN(Number(m.minimum))) {
            const v = Number(m.minimum);
            if (minVal === null || v < minVal) minVal = v;
          }
          if (m.maximum != null && !isNaN(Number(m.maximum))) {
            const v = Number(m.maximum);
            if (maxVal === null || v > maxVal) maxVal = v;
          }
        }
      }

      const avg = means.length > 0 ? (means.reduce((a, b) => a + b, 0) / means.length).toFixed(2) : '—';
      const rate = valid > 0 ? ((passed / valid) * 100).toFixed(1) + ' %' : '—';

      return {
        count: tasks.length,
        valid,
        passed,
        failed,
        avg,
        min: minVal !== null ? minVal.toFixed(2) : '—',
        max: maxVal !== null ? maxVal.toFixed(2) : '—',
        rate
      };
    };

    return {
      SHIELD_OVERLAP_RATE: calc('SHIELD_OVERLAP_RATE'),
      WIRE_GAP: calc('WIRE_GAP'),
      OVALITY: calc('OVALITY')
    };
  }, [filteredTasks]);

  // 导出 CSV
  function handleExportCsv() {
    const headers = ['任务编号', '盘号', '工单号', '电缆规格', '检测项', '状态', '有效点数', '超限点数', '均值', '单位'];
    const rows = filteredTasks.map(t => [
      t.task_code || t.id,
      t.context_snapshot?.spool_code || t.current_spool_code || '—',
      t.context_snapshot?.external_code || t.current_order_code || '—',
      t.context_snapshot?.specification?.name || t.specification_id,
      names[t.metric_code] || t.metric_code,
      taskState[t.state] || t.state,
      t.measurements?.valid ?? 0,
      t.measurements?.failed ?? 0,
      t.measurements?.mean ?? '—',
      t.measurements?.unit ?? ''
    ]);

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `慧眼智检-质量统计分析报表-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 分页数据
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const currentPageTasks = filteredTasks.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="analytics-page">
      <PageTitle
        title="质量统计分析"
        subtitle="多维度汇总生产全流程量测数据；按检测项目、产品规格及生产任务分析过程合格率与波动趋势。"
        actions={
          <>
            <Button onClick={() => void refresh()}>刷新统计</Button>
            <Button primary icon="download" onClick={handleExportCsv}>
              导出统计报表 (CSV)
            </Button>
          </>
        }
      />

      {/* 筛选过滤工具条 */}
      <div className="analytics-filter-grid">
        <Field label="检测项目">
          <select value={metricFilter} onChange={e => { setMetricFilter(e.target.value); setPage(1); }}>
            <option value="">全部三项检测指标</option>
            {Object.entries(names).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </Field>

        <Field label="任务执行状态">
          <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="RUNNING">仅检测中任务 (RUNNING)</option>
            <option value="ENDED">仅已结束任务 (ENDED)</option>
            <option value="CREATED">仅待开始任务 (CREATED)</option>
          </select>
        </Field>

        <Field label="产品规格档案">
          <select value={specFilter} onChange={e => { setSpecFilter(e.target.value); setPage(1); }}>
            <option value="">全部产品规格</option>
            {data.catalog.product_specification.map(s => (
              <option key={s.id} value={s.id}>{s.name || s.code || s.id}</option>
            ))}
          </select>
        </Field>

        <Field label="模糊检索 (任务 / 盘号 / 工单)">
          <input
            value={keyword}
            placeholder="输入任务编号、盘号或工单号"
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
          />
        </Field>
      </div>

      {/* 顶层四大 KPI 统计卡片 */}
      <div className="grid cols-4">
        <Kpi
          label="覆盖任务与电缆盘"
          value={`${aggregate.taskCount} 项 / ${aggregate.spoolCount} 盘`}
          note={`已排产累计长度约 ${aggregate.totalPlannedMeters} m`}
          icon="clipboard"
        />
        <Kpi
          label="累计有效量测点"
          value={aggregate.totalValid.toLocaleString()}
          note={`总采样 ${aggregate.totalSamples.toLocaleString()} 点`}
          icon="database"
        />
        <Kpi
          label="过程量测合格率"
          value={aggregate.passRate}
          note="按有效采样点位统计，不代表最终放行"
          icon="chart-line"
          tone="green"
        />
        <Kpi
          label="超限异常点数"
          value={aggregate.totalFailed}
          note="包含所有工序与任务的超限记录点"
          icon="alert-triangle"
          tone={aggregate.totalFailed > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* 三项指标卡片 */}
      <div className="metric-analysis-cards">
        {/* 金属屏蔽搭盖率 */}
        {(!metricFilter || metricFilter === 'SHIELD_OVERLAP_RATE') && (
          <Panel core title="金属屏蔽搭盖率检测统计">
            <div className="metric-card-inner">
              <div className="metric-val-hero">
                <span className="metric-val-num" style={{ color: '#155ab6' }}>
                  {metricStats.SHIELD_OVERLAP_RATE.avg}
                  <small>%</small>
                </span>
                <Badge tone="blue">受控基准 ≥15%</Badge>
              </div>

              <div className="metric-mini-chart">
                <div className="metric-mini-bar" style={{ height: '55%' }} />
                <div className="metric-mini-bar" style={{ height: '70%' }} />
                <div className="metric-mini-bar" style={{ height: '65%' }} />
                <div className="metric-mini-bar" style={{ height: '80%' }} />
                <div className="metric-mini-bar" style={{ height: '75%' }} />
                <div className="metric-mini-bar" style={{ height: '85%' }} />
                <div className="metric-mini-bar fail" style={{ height: '35%' }} title="局部超限点" />
                <div className="metric-mini-bar" style={{ height: '78%' }} />
              </div>

              <div className="metric-strip-grid">
                <div className="metric-strip-item">
                  <span className="muted">合格率</span>
                  <strong>{metricStats.SHIELD_OVERLAP_RATE.rate}</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">极小测量值</span>
                  <strong>{metricStats.SHIELD_OVERLAP_RATE.min} %</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">超限点位</span>
                  <strong style={{ color: metricStats.SHIELD_OVERLAP_RATE.failed > 0 ? '#b91c1c' : 'inherit' }}>
                    {metricStats.SHIELD_OVERLAP_RATE.failed}
                  </strong>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* 铜丝屏蔽间隙 */}
        {(!metricFilter || metricFilter === 'WIRE_GAP') && (
          <Panel core title="铜丝屏蔽相邻间隙统计">
            <div className="metric-card-inner">
              <div className="metric-val-hero">
                <span className="metric-val-num" style={{ color: '#0d824d' }}>
                  {metricStats.WIRE_GAP.avg}
                  <small>mm</small>
                </span>
                <Badge tone="green">标准限值 ≤3.0mm</Badge>
              </div>

              <div className="metric-mini-chart">
                <div className="metric-mini-bar" style={{ height: '40%' }} />
                <div className="metric-mini-bar" style={{ height: '45%' }} />
                <div className="metric-mini-bar" style={{ height: '38%' }} />
                <div className="metric-mini-bar" style={{ height: '50%' }} />
                <div className="metric-mini-bar" style={{ height: '42%' }} />
                <div className="metric-mini-bar" style={{ height: '48%' }} />
                <div className="metric-mini-bar" style={{ height: '44%' }} />
              </div>

              <div className="metric-strip-grid">
                <div className="metric-strip-item">
                  <span className="muted">合格率</span>
                  <strong>{metricStats.WIRE_GAP.rate}</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">最大间隙</span>
                  <strong>{metricStats.WIRE_GAP.max} mm</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">超限点位</span>
                  <strong style={{ color: metricStats.WIRE_GAP.failed > 0 ? '#b91c1c' : 'inherit' }}>
                    {metricStats.WIRE_GAP.failed}
                  </strong>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* 电缆不圆度 */}
        {(!metricFilter || metricFilter === 'OVALITY') && (
          <Panel core title="电缆截面不圆度统计">
            <div className="metric-card-inner">
              <div className="metric-val-hero">
                <span className="metric-val-num" style={{ color: '#7c3aed' }}>
                  {metricStats.OVALITY.avg}
                  <small>%</small>
                </span>
                <Badge tone="amber">标准限值 ≤8.0%</Badge>
              </div>

              <div className="metric-mini-chart">
                <div className="metric-mini-bar" style={{ height: '50%' }} />
                <div className="metric-mini-bar" style={{ height: '60%' }} />
                <div className="metric-mini-bar" style={{ height: '55%' }} />
                <div className="metric-mini-bar" style={{ height: '65%' }} />
                <div className="metric-mini-bar" style={{ height: '52%' }} />
                <div className="metric-mini-bar" style={{ height: '58%' }} />
              </div>

              <div className="metric-strip-grid">
                <div className="metric-strip-item">
                  <span className="muted">合格率</span>
                  <strong>{metricStats.OVALITY.rate}</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">最大不圆度</span>
                  <strong>{metricStats.OVALITY.max} %</strong>
                </div>
                <div className="metric-strip-item">
                  <span className="muted">超限点位</span>
                  <strong style={{ color: metricStats.OVALITY.failed > 0 ? '#b91c1c' : 'inherit' }}>
                    {metricStats.OVALITY.failed}
                  </strong>
                </div>
              </div>
            </div>
          </Panel>
        )}
      </div>

      {/* 逐任务/盘号明细汇总表格 */}
      <Panel
        core
        table
        title="任务量测统计明细"
        tools={<span className="muted small">共 {filteredTasks.length} 项检测任务</span>}
      >
        <DataTable
          headers={['任务编号 / 盘号', '工单 / 规格', '检测项目', '状态', '有效 / 超限点数', '平均量测值', '过程评定', '追溯操作']}
          rows={currentPageTasks.map(t => {
            const m = t.measurements;
            const valid = m?.valid ?? 0;
            const fail = m?.failed ?? 0;
            const avg = m?.mean != null ? `${m.mean} ${m.unit || ''}` : '—';
            const range = m?.minimum != null && m?.maximum != null ? `(${m.minimum} ~ ${m.maximum})` : '';

            return [
              <div key={t.id}>
                <strong>{t.task_code || t.id}</strong>
                <div className="muted small">
                  盘号：{t.context_snapshot?.spool_code || t.current_spool_code || '—'}
                </div>
              </div>,
              <div>
                <div>{t.context_snapshot?.external_code || t.current_order_code || '—'}</div>
                <small className="muted">{t.context_snapshot?.specification?.name || t.specification_id}</small>
              </div>,
              <div>{names[t.metric_code] || t.metric_code}</div>,
              <Badge tone={t.state === 'RUNNING' ? 'blue' : t.state === 'ENDED' ? 'gray' : 'amber'}>
                {taskState[t.state] || t.state}
              </Badge>,
              <div>
                <span>{valid} 点</span>
                {fail > 0 ? (
                  <span style={{ color: '#b91c1c', marginLeft: 6, fontWeight: 600 }}>({fail} 超限)</span>
                ) : (
                  <span style={{ color: '#0d824d', marginLeft: 6 }}>(0 超限)</span>
                )}
              </div>,
              <div>
                <strong>{avg}</strong>
                {range && <div className="muted small">{range}</div>}
              </div>,
              fail > 0 ? (
                <Badge tone="red">存在超限</Badge>
              ) : valid > 0 ? (
                <Badge tone="green">符合标准</Badge>
              ) : (
                <Badge tone="gray">暂无采样</Badge>
              ),
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <HashLink route={`history?task_id=${t.id}`}>原始记录</HashLink>
                {t.spool_id && <HashLink route={`trace?spool=${t.spool_id}`}>线缆追溯</HashLink>}
              </div>
            ];
          })}
        />
        {filteredTasks.length > pageSize && (
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'flex-end' }}>
            <div className="pagination">
              <span>共 {filteredTasks.length} 条记录</span>
              <div className="page-controls">
                <Button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</Button>
                <span className="page-number">{page}</span>
                <span>/ {totalPages}</span>
                <Button type="button" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</Button>
                <span>{pageSize} 条 / 页</span>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Note>
        <strong>质量统计说明：</strong>
        上述过程合格率由各任务周期内接收的有效物理量测点计算得出。若任务存在超限点，请在报警与复核记录中核对处置结论；单盘出厂前须在「质量报告管理」中出具经审核的正式质量报告。
      </Note>
    </div>
  );
}
