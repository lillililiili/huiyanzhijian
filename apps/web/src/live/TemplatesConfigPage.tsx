import { useState, useMemo } from 'react';
import { PageTitle } from '../ui/PageTitle';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Note } from '../ui/Note';
import { Field, TextInput } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { DataTable } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import type { Person, Workspace, ApiClient, Commands } from './api';
import './templates.css';

export type TemplateCategory = 'CABLE_INSPECTION_SINGLE' | 'CABLE_INSPECTION_SUMMARY' | 'BATCH_DISPATCH';

export interface ReportTemplateConfig {
  id: string;
  category: TemplateCategory;
  name: string;
  version: string;
  revision: number;
  company: string;
  title: string;
  subtitle: string;
  signatory: string;
  footer: string;
  disclaimer: string;
  includeLogo: boolean;
  includeTrend: boolean;
  includeAlarms: boolean;
  includeDetails: boolean;
  includeDeviceSnapshot: boolean;
  includeSourceDeclaration: boolean;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  changeReason?: string;
}

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  version: string;
  revision: number;
  snapshot: ReportTemplateConfig;
  updatedBy: string;
  updatedAt: string;
  changeReason: string;
}

const STORAGE_KEY_TEMPLATES = 'huiyan_report_templates_v2';
const STORAGE_KEY_VERSIONS = 'huiyan_report_template_versions_v2';

const DEFAULT_TEMPLATES: Record<TemplateCategory, ReportTemplateConfig> = {
  CABLE_INSPECTION_SINGLE: {
    id: 'TPL-SINGLE-01',
    category: 'CABLE_INSPECTION_SINGLE',
    name: '高压电缆单项指标检测报告模板',
    version: 'V1.0',
    revision: 1,
    company: '山东宏亮电缆有限公司',
    title: '高压电缆单项质量检测报告',
    subtitle: '针对金属屏蔽搭盖率、铜丝间隙或电缆不圆度单项检测任务出具的专项报告',
    signatory: '检验员：____________    复核人：____________    质量管理部：____________',
    footer: '山东宏亮电缆有限公司 · 慧眼智检 质见未来 · 生产质检专用',
    disclaimer: '本报告仅反映所关联检测任务及所配置检测项目之实际测量结果；未检测或不适用项目不作质量推断。',
    includeLogo: true,
    includeTrend: true,
    includeAlarms: true,
    includeDetails: true,
    includeDeviceSnapshot: true,
    includeSourceDeclaration: true,
    enabled: true,
    updatedAt: '2026-10-26 12:00:00',
    updatedBy: '系统出厂预设',
    changeReason: '系统初始受控基线发布'
  },
  CABLE_INSPECTION_SUMMARY: {
    id: 'TPL-SUMMARY-01',
    category: 'CABLE_INSPECTION_SUMMARY',
    name: '高压电缆整盘多指标综合检测报告模板',
    version: 'V1.0',
    revision: 1,
    company: '山东宏亮电缆有限公司',
    title: '高压电缆整盘多工序综合质量检测报告',
    subtitle: '涵盖金属屏蔽搭盖率、铜丝间隙、电缆不圆度等多项工序的全盘检测综合报告',
    signatory: '质检工程师：____________    复核工程师：____________    质量负责人：____________',
    footer: '山东宏亮电缆有限公司 · 质量安全协同管控 · 出厂检验合格归档',
    disclaimer: '本报告汇总该电缆盘在全工序流程下的各项检测快照与统计结果，各项指标分别判定。',
    includeLogo: true,
    includeTrend: true,
    includeAlarms: true,
    includeDetails: false,
    includeDeviceSnapshot: true,
    includeSourceDeclaration: true,
    enabled: true,
    updatedAt: '2026-10-26 12:00:00',
    updatedBy: '系统出厂预设',
    changeReason: '系统初始受控基线发布'
  },
  BATCH_DISPATCH: {
    id: 'TPL-BATCH-01',
    category: 'BATCH_DISPATCH',
    name: '生产工单批次质量汇总报表模板',
    version: 'V1.0',
    revision: 1,
    company: '山东宏亮电缆有限公司',
    title: '高压电缆生产工单批次质量汇总报告',
    subtitle: '按生产工单与计划批次汇总所辖多盘电缆的检测合格率与生产流水',
    signatory: '生产调度：____________    质量检验主管：____________    技术总监：____________',
    footer: '山东宏亮电缆有限公司 · 批次质量档案备查',
    disclaimer: '本报表按工单组织统计，明细盘号数据请查阅对应单盘质量检测报告。',
    includeLogo: true,
    includeTrend: false,
    includeAlarms: true,
    includeDetails: true,
    includeDeviceSnapshot: false,
    includeSourceDeclaration: true,
    enabled: true,
    updatedAt: '2026-10-26 12:00:00',
    updatedBy: '系统出厂预设',
    changeReason: '系统初始受控基线发布'
  }
};

const ESSENTIAL_ITEMS = [
  { label: '报告编号与生成时间', note: '系统唯一单据号，生成时冻结时间戳，不可缺省' },
  { label: '任务、盘号与设备标识', note: '生产实体追溯事实，严禁隐藏或假定' },
  { label: '冻结判定规则与标准快照', note: '包含执行标准、阈值及比较方向，不可被后续修改改变' },
  { label: '阶段 / 最终报告标记与判定', note: '未判定或缺测明确标出，禁止将未测视作合格' },
  { label: '数据来源真实性声明', note: '明确标注 REAL 或 SIMULATED 来源环境，严守合规红线' }
];

function loadTemplates(): Record<TemplateCategory, ReportTemplateConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
    if (!raw) return { ...DEFAULT_TEMPLATES };
    const parsed = JSON.parse(raw);
    return {
      CABLE_INSPECTION_SINGLE: { ...DEFAULT_TEMPLATES.CABLE_INSPECTION_SINGLE, ...parsed.CABLE_INSPECTION_SINGLE },
      CABLE_INSPECTION_SUMMARY: { ...DEFAULT_TEMPLATES.CABLE_INSPECTION_SUMMARY, ...parsed.CABLE_INSPECTION_SUMMARY },
      BATCH_DISPATCH: { ...DEFAULT_TEMPLATES.BATCH_DISPATCH, ...parsed.BATCH_DISPATCH }
    };
  } catch {
    return { ...DEFAULT_TEMPLATES };
  }
}

function loadVersions(): TemplateVersionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VERSIONS);
    if (!raw) {
      return Object.values(DEFAULT_TEMPLATES).map(tpl => ({
        id: `VER-${tpl.id}-1`,
        templateId: tpl.id,
        version: tpl.version,
        revision: tpl.revision,
        snapshot: { ...tpl },
        updatedBy: tpl.updatedBy,
        updatedAt: tpl.updatedAt,
        changeReason: tpl.changeReason || '初始基线'
      }));
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

interface Props {
  user: Person;
  data: Workspace;
  api: ApiClient;
  commands: Commands;
  refresh: () => Promise<void>;
}

export function TemplatesConfigPage({ user }: Props) {
  const [category, setCategory] = useState<TemplateCategory>('CABLE_INSPECTION_SINGLE');
  const [templates, setTemplates] = useState<Record<TemplateCategory, ReportTemplateConfig>>(loadTemplates);
  const [versions, setVersions] = useState<TemplateVersionRecord[]>(loadVersions);
  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [inspectingSnapshot, setInspectingSnapshot] = useState<ReportTemplateConfig | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const currentTemplate = templates[category];

  // 权限判断：管理员或具备质检/规则写权限
  const canEdit = useMemo(() => {
    return (
      user.permissions.includes('quality:write') ||
      user.permissions.includes('rules:write') ||
      user.permissions.includes('audit:read') ||
      user.permissions.includes('admin')
    );
  }, [user]);

  function persistTemplates(nextTemplates: Record<TemplateCategory, ReportTemplateConfig>, nextVersions: TemplateVersionRecord[]) {
    setTemplates(nextTemplates);
    setVersions(nextVersions);
    try {
      localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(nextTemplates));
      localStorage.setItem(STORAGE_KEY_VERSIONS, JSON.stringify(nextVersions));
      window.dispatchEvent(new CustomEvent('huiyan-template-changed', { detail: nextTemplates }));
    } catch {
      // 存储异常保护
    }
  }

  function handleSave(updatedDraft: Partial<ReportTemplateConfig>, reason: string) {
    const nextRevision = (currentTemplate.revision || 1) + 1;
    const nextVersion = `V1.${nextRevision - 1}`;
    const nowTime = new Date().toLocaleString('zh-CN', { hour12: false });
    const actor = user.name || user.username || '当前用户';

    const nextConfig: ReportTemplateConfig = {
      ...currentTemplate,
      ...updatedDraft,
      revision: nextRevision,
      version: nextVersion,
      updatedAt: nowTime,
      updatedBy: actor,
      changeReason: reason
    };

    const nextTemplates = {
      ...templates,
      [category]: nextConfig
    };

    const newVersionRecord: TemplateVersionRecord = {
      id: `VER-${nextConfig.id}-${nextRevision}`,
      templateId: nextConfig.id,
      version: nextVersion,
      revision: nextRevision,
      snapshot: nextConfig,
      updatedBy: actor,
      updatedAt: nowTime,
      changeReason: reason
    };

    const nextVersions = [newVersionRecord, ...versions];
    persistTemplates(nextTemplates, nextVersions);
    setIsEditing(false);
    toast(`模板已更新，发布新版本 ${nextVersion}。新版本仅应用于后续新生成的报告。`);
  }

  function handleReset() {
    const defaultTemplate = DEFAULT_TEMPLATES[category];
    const nextRevision = (currentTemplate.revision || 1) + 1;
    const nextVersion = `V1.${nextRevision - 1}`;
    const nowTime = new Date().toLocaleString('zh-CN', { hour12: false });
    const actor = user.name || user.username || '当前用户';

    const restoredConfig: ReportTemplateConfig = {
      ...defaultTemplate,
      revision: nextRevision,
      version: nextVersion,
      updatedAt: nowTime,
      updatedBy: actor,
      changeReason: '恢复系统出厂预设模板'
    };

    const nextTemplates = {
      ...templates,
      [category]: restoredConfig
    };

    const newVersionRecord: TemplateVersionRecord = {
      id: `VER-${restoredConfig.id}-${nextRevision}`,
      templateId: restoredConfig.id,
      version: nextVersion,
      revision: nextRevision,
      snapshot: restoredConfig,
      updatedBy: actor,
      updatedAt: nowTime,
      changeReason: '恢复系统出厂预设模板'
    };

    persistTemplates(nextTemplates, [newVersionRecord, ...versions]);
    setConfirmReset(false);
    toast(`已恢复出厂设置并生成受控版本 ${nextVersion}。`);
  }

  const categoryVersions = versions.filter(v => v.templateId === currentTemplate.id);

  return (
    <div className="tpl-container">
      <PageTitle
        title="报告模板配置"
        subtitle="维护出厂与过程质量报告受控抬头、内容组成、签审栏与版本；修改仅应用于之后新生成的报告。"
        actions={
          <>
            <Button onClick={() => setShowHistory(true)}>版本履历 ({categoryVersions.length})</Button>
            {canEdit && (
              <Button onClick={() => setConfirmReset(true)}>恢复出厂</Button>
            )}
            <Button
              primary
              icon="edit"
              disabled={!canEdit}
              onClick={() => setIsEditing(true)}
            >
              编辑报告模板
            </Button>
          </>
        }
      />

      {!canEdit && (
        <Note>
          当前账号仅具备只读权限，可以查看模板样式与受控要素。模板编辑、启停或升级需质量主管或管理员权限。
        </Note>
      )}

      {/* 模板类型切换 Tabs */}
      <div className="tpl-tabs" role="tablist" aria-label="报告模板分类">
        <button
          role="tab"
          aria-selected={category === 'CABLE_INSPECTION_SINGLE'}
          className={`tpl-tab-btn ${category === 'CABLE_INSPECTION_SINGLE' ? 'active' : ''}`}
          onClick={() => setCategory('CABLE_INSPECTION_SINGLE')}
        >
          单项指标检测报告模板
        </button>
        <button
          role="tab"
          aria-selected={category === 'CABLE_INSPECTION_SUMMARY'}
          className={`tpl-tab-btn ${category === 'CABLE_INSPECTION_SUMMARY' ? 'active' : ''}`}
          onClick={() => setCategory('CABLE_INSPECTION_SUMMARY')}
        >
          整盘综合质量检测报告模板
        </button>
        <button
          role="tab"
          aria-selected={category === 'BATCH_DISPATCH'}
          className={`tpl-tab-btn ${category === 'BATCH_DISPATCH' ? 'active' : ''}`}
          onClick={() => setCategory('BATCH_DISPATCH')}
        >
          工单批次质量汇总报表模板
        </button>
      </div>

      <div className="tpl-split-layout">
        {/* 左侧：高保真 A4 纸质/PDF 预览 */}
        <Panel core title="报告纸质 / PDF 预览 (所见即所得)">
          <div className="report-paper">
            {/* 顶栏：Logo 与编号 */}
            <div className="report-header-row">
              <div>
                {currentTemplate.includeLogo ? (
                  <img src="assets/images/logo.png" alt="慧眼智检" className="report-logo-img" />
                ) : (
                  <strong style={{ fontSize: 18, color: '#155ab6' }}>{currentTemplate.company}</strong>
                )}
              </div>
              <div className="report-header-meta">
                <div>报告编号：<strong>RP-20261028-001</strong></div>
                <div>生成时间：2026-10-28 10:30:00</div>
                <div>模板版本：<Badge tone="blue">{currentTemplate.version} (受控)</Badge></div>
              </div>
            </div>

            {/* 报告主标题与副标题 */}
            <div className="report-title-section">
              <h2 className="report-main-title">{currentTemplate.title}</h2>
              <p className="report-subtitle">{currentTemplate.subtitle}</p>
            </div>

            {/* 必备元数据表格 */}
            <table className="report-meta-table">
              <tbody>
                <tr>
                  <th>检测任务</th>
                  <td>T2026102801 (自动填充)</td>
                  <th>电缆盘号</th>
                  <td>P2026102801 (自动填充)</td>
                </tr>
                <tr>
                  <th>生产工单</th>
                  <td>WO2026102801 (自动填充)</td>
                  <th>电缆规格</th>
                  <td>YJLW03-64/110kV-1×800mm²</td>
                </tr>
                <tr>
                  <th>检测工序</th>
                  <td>金属屏蔽联锁铠装</td>
                  <th>适用检测项</th>
                  <td>
                    {category === 'CABLE_INSPECTION_SINGLE'
                      ? '金属屏蔽搭盖率 / 铜丝间隙 / 不圆度'
                      : '整盘全项指标综合评定'}
                  </td>
                </tr>
                <tr>
                  <th>判定规则快照</th>
                  <td>搭盖率≥15% (生成时快照)</td>
                  <th>报告性质</th>
                  <td><Badge tone="green">最终报告 (正式出厂)</Badge></td>
                </tr>
              </tbody>
            </table>

            {/* 数据汇总区块 */}
            <div className="report-section">
              <div className="report-section-title">
                <span>检测数据概况与质量评定</span>
                <Badge tone="green">符合标准要求</Badge>
              </div>
              <div className="report-summary-stats">
                <div className="report-stat-box">
                  <div className="report-stat-label">总检测长度</div>
                  <div className="report-stat-val">2,500.0 m</div>
                </div>
                <div className="report-stat-box">
                  <div className="report-stat-label">有效采样点数</div>
                  <div className="report-stat-val">1,820 点</div>
                </div>
                <div className="report-stat-box">
                  <div className="report-stat-label">数据合格率</div>
                  <div className="report-stat-val passed">99.8 %</div>
                </div>
                <div className="report-stat-box">
                  <div className="report-stat-label">平均测量值</div>
                  <div className="report-stat-val">18.4 %</div>
                </div>
              </div>

              {/* 可选区块：量测趋势图 */}
              {currentTemplate.includeTrend && (
                <div className="report-trend-mock">
                  <div style={{ fontWeight: 600, marginBottom: 4, color: '#17324f' }}>
                    全线量测波动与趋势分布
                  </div>
                  <div className="report-trend-canvas-mock">
                    <div className="report-trend-bar" style={{ height: '40%' }} />
                    <div className="report-trend-bar" style={{ height: '55%' }} />
                    <div className="report-trend-bar highlight" style={{ height: '70%' }} />
                    <div className="report-trend-bar" style={{ height: '60%' }} />
                    <div className="report-trend-bar" style={{ height: '65%' }} />
                    <div className="report-trend-bar" style={{ height: '58%' }} />
                    <div className="report-trend-bar" style={{ height: '72%' }} />
                    <div className="report-trend-bar" style={{ height: '62%' }} />
                  </div>
                  <span>采样点逐米连续记录趋势（由图表引擎渲染）</span>
                </div>
              )}
            </div>

            {/* 可选区块：超限报警与复核记录 */}
            {currentTemplate.includeAlarms && (
              <div className="report-section">
                <div className="report-section-title">
                  <span>超限报警与质检复核处置记录</span>
                  <Badge tone="amber">1 条已复核处置</Badge>
                </div>
                <table className="report-alarms-mock">
                  <thead>
                    <tr>
                      <th>报警米数</th>
                      <th>测量值 / 阈值</th>
                      <th>偏差原因</th>
                      <th>处置意见</th>
                      <th>复核人</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>1,240.5 m</td>
                      <td>12.3% (标准 ≥15%)</td>
                      <td>局部搭盖偏窄</td>
                      <td>已进行人工补焊修整并通过复检</td>
                      <td>质检员01</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* 可选区块：逐米原始测量明细 */}
            {currentTemplate.includeDetails && (
              <div className="report-section">
                <div className="report-section-title">
                  <span>量测明细数据摘要 (前 3 组示例)</span>
                  <span className="muted small">完整明细详见报告附件 Excel</span>
                </div>
                <table className="report-alarms-mock">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>采样米数</th>
                      <th>测量数值</th>
                      <th>有效性判定</th>
                      <th>记录时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>0001</td>
                      <td>0.5 m</td>
                      <td>17.8 %</td>
                      <td><span style={{ color: '#0d824d' }}>有效</span></td>
                      <td>10:05:12</td>
                    </tr>
                    <tr>
                      <td>0002</td>
                      <td>1.0 m</td>
                      <td>18.1 %</td>
                      <td><span style={{ color: '#0d824d' }}>有效</span></td>
                      <td>10:05:15</td>
                    </tr>
                    <tr>
                      <td>0003</td>
                      <td>1.5 m</td>
                      <td>18.0 %</td>
                      <td><span style={{ color: '#0d824d' }}>有效</span></td>
                      <td>10:05:18</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* 可选区块：设备与参数快照 */}
            {currentTemplate.includeDeviceSnapshot && (
              <div className="report-section">
                <div className="report-section-title">
                  <span>检测设备与工位参数快照</span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div>检测设备：DEV-AR01 (铠装检测仪)</div>
                  <div>工位线体：1号高压产线</div>
                  <div>校准周期：有效期至 2026-12-31</div>
                  <div>采集算法：光学几何轮廓视觉算法 V2.1</div>
                </div>
              </div>
            )}

            {/* 可选区块：数据来源环境声明 */}
            {currentTemplate.includeSourceDeclaration && (
              <div className="report-section">
                <div className="report-section-title">
                  <span>数据来源与真实性声明</span>
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                  数据来源环境：<strong>REAL 工业现场直连采集</strong>。本报告由慧眼智检质量管控平台依据实时数据与防篡改日志自动生成，确保过程数据客观真实。
                </p>
              </div>
            )}

            {/* 签审责任栏 */}
            <div className="report-sign-area">
              <div className="report-sign-row">
                <span>{currentTemplate.signatory}</span>
                <span>签发日期：2026 年 10 月 28 日</span>
              </div>
              <div className="report-compliance-note">
                <strong>签审与合规说明：</strong>
                {currentTemplate.disclaimer}
                （注：签审栏为纸质/PDF展示内容，文字签名不替代具有法律效力的电子签章或特种设备放行证明。）
              </div>
            </div>

            {/* 页脚 */}
            <div className="report-footer-area">
              <div>{currentTemplate.footer}</div>
              <div style={{ marginTop: 4 }}>
                编制企业：{currentTemplate.company} · 受控版本：{currentTemplate.version} · 打印时间：2026-10-28 10:30
              </div>
            </div>
          </div>
        </Panel>

        {/* 右侧：受控规范与管理信息面板 */}
        <div className="tpl-info-group">
          {/* 模板状态与版本 */}
          <Panel core title="受控模板属性">
            <div className="detail-grid">
              <div className="meta-item">
                <span className="muted small">模板名称</span>
                <div><strong>{currentTemplate.name}</strong></div>
              </div>
              <div className="meta-item">
                <span className="muted small">受控版本</span>
                <div><Badge tone="blue">{currentTemplate.version}</Badge></div>
              </div>
              <div className="meta-item">
                <span className="muted small">所属分类</span>
                <div>{category === 'CABLE_INSPECTION_SINGLE' ? '单项指标报告' : category === 'CABLE_INSPECTION_SUMMARY' ? '多项综合报告' : '批次工单报表'}</div>
              </div>
              <div className="meta-item">
                <span className="muted small">最后修改人</span>
                <div>{currentTemplate.updatedBy}</div>
              </div>
              <div className="meta-item">
                <span className="muted small">最后修改时间</span>
                <div>{currentTemplate.updatedAt}</div>
              </div>
              <div className="meta-item">
                <span className="muted small">生效机制</span>
                <div><Badge tone="green">仅作用于新报告</Badge></div>
              </div>
            </div>
            {currentTemplate.changeReason && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#475569' }}>
                <span className="muted">最后变更原因：</span>
                <span className="tpl-history-reason">{currentTemplate.changeReason}</span>
              </div>
            )}
          </Panel>

          {/* 质量安全红线：必备要素 */}
          <Panel core title="受控必备要素 (不可缺省红线)">
            <p className="muted small" style={{ margin: '0 0 10px' }}>
              依据系统合规准则（AC17与DP15.02），以下要素为出具质量检验报告的法定必须项，不可关闭或人为隐藏：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ESSENTIAL_ITEMS.map(item => (
                <div key={item.label} className="tpl-essential-item">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Icon name="check" size={16} />
                      <span>{item.label}</span>
                    </div>
                    <small className="muted">{item.note}</small>
                  </div>
                  <Badge tone="gray">必备</Badge>
                </div>
              ))}
            </div>
          </Panel>

          {/* 核心质量准则提示 */}
          <Note>
            <strong>报告受控原则：</strong>
            修改模板将生成递增的受控版本（如 V1.0 → V1.1）。新模板仅应用于保存后生成的新报告；已有历史报告保持当时生成的原始快照，严禁通过修改模板反向覆盖历史检测结论。
          </Note>
        </div>
      </div>

      {/* 编辑模板 Modal */}
      {isEditing && (
        <TemplateEditorModal
          template={currentTemplate}
          onClose={() => setIsEditing(false)}
          onSave={handleSave}
        />
      )}

      {/* 版本履历 Modal */}
      {showHistory && (
        <TemplateHistoryModal
          versions={categoryVersions}
          onClose={() => setShowHistory(false)}
          onInspect={snapshot => setInspectingSnapshot(snapshot)}
        />
      )}

      {/* 快照对比/查看 Modal */}
      {inspectingSnapshot && (
        <SnapshotViewerModal
          snapshot={inspectingSnapshot}
          onClose={() => setInspectingSnapshot(null)}
        />
      )}

      {/* 恢复出厂确认 Modal */}
      {confirmReset && (
        <Modal
          title="恢复出厂预设模板"
          open
          submitLabel="确认恢复出厂"
          onClose={() => setConfirmReset(false)}
          onSubmit={handleReset}
        >
          <Note>
            确定要将当前 <strong>{currentTemplate.name}</strong> 恢复为系统默认出厂模板吗？
            系统将自动递增受控版本号并归档当前配置，已有历史报告依然保持原始快照不变。
          </Note>
        </Modal>
      )}
    </div>
  );
}

interface EditorModalProps {
  template: ReportTemplateConfig;
  onClose: () => void;
  onSave: (draft: Partial<ReportTemplateConfig>, reason: string) => void;
}

function TemplateEditorModal({ template, onClose, onSave }: EditorModalProps) {
  const [title, setTitle] = useState(template.title);
  const [subtitle, setSubtitle] = useState(template.subtitle);
  const [company, setCompany] = useState(template.company);
  const [signatory, setSignatory] = useState(template.signatory);
  const [footer, setFooter] = useState(template.footer);
  const [disclaimer, setDisclaimer] = useState(template.disclaimer);
  const [reason, setReason] = useState('');

  const [includeLogo, setIncludeLogo] = useState(template.includeLogo);
  const [includeTrend, setIncludeTrend] = useState(template.includeTrend);
  const [includeAlarms, setIncludeAlarms] = useState(template.includeAlarms);
  const [includeDetails, setIncludeDetails] = useState(template.includeDetails);
  const [includeDeviceSnapshot, setIncludeDeviceSnapshot] = useState(template.includeDeviceSnapshot);
  const [includeSourceDeclaration, setIncludeSourceDeclaration] = useState(template.includeSourceDeclaration);

  function handleModalSubmit(formData: FormData) {
    const cleanTitle = String(formData.get('title') || '').trim();
    if (!cleanTitle) {
      throw new Error('请填写报告抬头');
    }
    const cleanReason = String(formData.get('reason') || '').trim();
    if (!cleanReason) {
      throw new Error('受控规范要求：必须输入修改原因以供履历追溯');
    }

    onSave(
      {
        title: cleanTitle,
        subtitle: String(formData.get('subtitle') || '').trim(),
        company: String(formData.get('company') || '').trim(),
        signatory: String(formData.get('signatory') || '').trim(),
        footer: String(formData.get('footer') || '').trim(),
        disclaimer: String(formData.get('disclaimer') || '').trim(),
        includeLogo: formData.has('includeLogo'),
        includeTrend: formData.has('includeTrend'),
        includeAlarms: formData.has('includeAlarms'),
        includeDetails: formData.has('includeDetails'),
        includeDeviceSnapshot: formData.has('includeDeviceSnapshot'),
        includeSourceDeclaration: formData.has('includeSourceDeclaration')
      },
      cleanReason
    );
  }

  return (
    <Modal
      title={`编辑报告模板 · ${template.name} (${template.version})`}
      open
      submitLabel="保存并发布新版本"
      onClose={onClose}
      onSubmit={handleModalSubmit}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Note>
          保存后将生成递增版本（如 {template.version} → V1.{template.revision}），修改原因将永久记录在受控履历中。
        </Note>

        <div className="tpl-editor-grid">
          <Field label="报告抬头 (主标题)">
            <TextInput
              name="title"
              value={title}
              required
              placeholder="例如：高压电缆出厂质量检测报告"
              onChange={e => setTitle(e.target.value)}
            />
          </Field>
          <Field label="编制企业全称">
            <TextInput
              name="company"
              value={company}
              required
              placeholder="例如：山东宏亮电缆有限公司"
              onChange={e => setCompany(e.target.value)}
            />
          </Field>
        </div>

        <Field label="报告副标题说明">
          <TextInput
            name="subtitle"
            value={subtitle}
            placeholder="例如：针对高压电缆金属屏蔽与几何尺寸出厂检验报告"
            onChange={e => setSubtitle(e.target.value)}
          />
        </Field>

        <Field label="签审栏配置 (打印签字位置)">
          <TextInput
            name="signatory"
            value={signatory}
            required
            placeholder="例如：检验员：____________  复核人：____________  质量负责人：____________"
            onChange={e => setSignatory(e.target.value)}
          />
        </Field>

        <Field label="页脚质量承诺与企业宣传">
          <TextInput
            name="footer"
            value={footer}
            placeholder="例如：山东宏亮电缆有限公司 · 慧眼智检 质见未来"
            onChange={e => setFooter(e.target.value)}
          />
        </Field>

        <Field label="法律免责与检验依据说明">
          <textarea
            name="disclaimer"
            rows={2}
            value={disclaimer}
            onChange={e => setDisclaimer(e.target.value)}
            aria-label="法律免责与检验依据说明"
          />
        </Field>

        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#17324f' }}>可选内容组成区块：</span>
          <div className="tpl-checkbox-grid">
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeLogo"
                checked={includeLogo}
                onChange={e => setIncludeLogo(e.target.checked)}
              />
              <span>显示品牌 Logo 标志</span>
            </label>
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeTrend"
                checked={includeTrend}
                onChange={e => setIncludeTrend(e.target.checked)}
              />
              <span>显示量测趋势图表</span>
            </label>
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeAlarms"
                checked={includeAlarms}
                onChange={e => setIncludeAlarms(e.target.checked)}
              />
              <span>显示超限报警与复核记录</span>
            </label>
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeDetails"
                checked={includeDetails}
                onChange={e => setIncludeDetails(e.target.checked)}
              />
              <span>显示逐米量测明细数据</span>
            </label>
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeDeviceSnapshot"
                checked={includeDeviceSnapshot}
                onChange={e => setIncludeDeviceSnapshot(e.target.checked)}
              />
              <span>显示检测设备与工位参数快照</span>
            </label>
            <label className="tpl-checkbox-item">
              <input
                type="checkbox"
                name="includeSourceDeclaration"
                checked={includeSourceDeclaration}
                onChange={e => setIncludeSourceDeclaration(e.target.checked)}
              />
              <span>显示数据来源环境真实性声明</span>
            </label>
          </div>
        </div>

        <Field label="修改原因 (受控规范强制必填)">
          <TextInput
            name="reason"
            value={reason}
            required
            placeholder="请详述本次模板调整依据，例如：按质检部要求更新签字栏格式"
            onChange={e => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

interface HistoryModalProps {
  versions: TemplateVersionRecord[];
  onClose: () => void;
  onInspect: (snapshot: ReportTemplateConfig) => void;
}

function TemplateHistoryModal({ versions, onClose, onInspect }: HistoryModalProps) {
  const rows = versions.map((ver, idx) => [
    ver.version,
    idx === 0 ? <Badge tone="blue">当前生效</Badge> : <Badge tone="gray">已归档快照</Badge>,
    ver.snapshot.title,
    ver.updatedBy,
    ver.changeReason,
    ver.updatedAt,
    <Button key={ver.id} onClick={() => onInspect(ver.snapshot)}>查看快照</Button>
  ]);

  return (
    <Modal
      title="受控模板版本履历"
      open
      submitLabel="关闭"
      onClose={onClose}
      onSubmit={onClose}
    >
      <div className="tpl-history-modal">
        <Note>
          受控版本管理规则：每次编辑均留存完整版本快照与修改原因。历史报告导出时严格绑定出具时刻的模板快照，新旧版本互不干扰。
        </Note>
        <DataTable
          headers={['版本号', '状态', '报告抬头', '修改人', '修改原因', '修改时间', '操作']}
          rows={rows}
        />
      </div>
    </Modal>
  );
}

interface SnapshotViewerModalProps {
  snapshot: ReportTemplateConfig;
  onClose: () => void;
}

function SnapshotViewerModal({ snapshot, onClose }: SnapshotViewerModalProps) {
  return (
    <Modal
      title={`版本快照查看 · ${snapshot.name} (${snapshot.version})`}
      open
      submitLabel="返回履历列表"
      onClose={onClose}
      onSubmit={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="detail-grid">
          <div className="meta-item">
            <span className="muted small">版本编号</span>
            <div><Badge tone="blue">{snapshot.version}</Badge></div>
          </div>
          <div className="meta-item">
            <span className="muted small">编制单位</span>
            <div>{snapshot.company}</div>
          </div>
          <div className="meta-item">
            <span className="muted small">报告抬头</span>
            <div><strong>{snapshot.title}</strong></div>
          </div>
          <div className="meta-item">
            <span className="muted small">修改人</span>
            <div>{snapshot.updatedBy}</div>
          </div>
          <div className="meta-item">
            <span className="muted small">修改时间</span>
            <div>{snapshot.updatedAt}</div>
          </div>
          <div className="meta-item">
            <span className="muted small">变更原因</span>
            <div className="tpl-history-reason">{snapshot.changeReason}</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #dce4ee', paddingTop: 10 }}>
          <span className="muted small">签审栏设置：</span>
          <p style={{ margin: '4px 0', fontSize: 13, background: '#f8fafc', padding: 8, borderRadius: 4 }}>
            {snapshot.signatory}
          </p>
        </div>

        <div>
          <span className="muted small">页脚设置：</span>
          <p style={{ margin: '4px 0', fontSize: 13, background: '#f8fafc', padding: 8, borderRadius: 4 }}>
            {snapshot.footer}
          </p>
        </div>

        <div>
          <span className="muted small">启用区块：</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {snapshot.includeLogo && <Badge tone="green">品牌 Logo</Badge>}
            {snapshot.includeTrend && <Badge tone="blue">量测趋势图表</Badge>}
            {snapshot.includeAlarms && <Badge tone="amber">超限报警记录</Badge>}
            {snapshot.includeDetails && <Badge tone="blue">量测明细数据</Badge>}
            {snapshot.includeDeviceSnapshot && <Badge tone="gray">设备参数快照</Badge>}
            {snapshot.includeSourceDeclaration && <Badge tone="gray">来源真实性声明</Badge>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
