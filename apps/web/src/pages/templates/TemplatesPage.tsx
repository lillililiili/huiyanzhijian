import { useState } from "react";
import { useSyncExternalStore } from "react";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import type { InspectionStore } from "../../domain/store";
import type { ReportTemplate, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field, TextInput } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { MetaItem } from "../present";

const CONTENTS = ["报告编号与生成时间", "任务、盘号与设备信息", "当时规则与统计结果", "阶段 / 最终报告标记", "数据来源与演示声明"];

/** Prototype ternaries. `??` would treat an explicit false like a missing flag. */
function templateFlags(template: ReportTemplate) {
  return {
    includeLogo: template.includeLogo !== false,
    includeTrend: template.includeTrend === undefined ? template.showCharts !== false : template.includeTrend,
    includeAlarms: template.includeAlarms === undefined ? template.showAlarms !== false : template.includeAlarms,
    includeDetails: template.includeDetails === undefined ? template.showRecords === true : template.includeDetails
  };
}

export function TemplatesPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const template = state.reportTemplate;
  const flags = templateFlags(template);
  const [open, setOpen] = useState(false);
  const title = template.title || template.header || "高压电缆质量检测报告";
  const signatory = template.signatory || template.reviewer || "复核人：____________";
  const footer = template.footer || "山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来";

  function openEditor() {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <PageTitle
        title="报告模板配置"
        subtitle="维护统一的报告抬头、内容与签审栏；修改仅应用于之后生成的报告。"
        actions={<Button primary icon="edit" onClick={openEditor}>编辑报告模板</Button>}
      />
      <div className="split">
        <Panel core title="模板预览">
          <div style={{ border: "1px solid #e7edf5", padding: 28, borderRadius: 8 }}>
            <div className="row">
              {flags.includeLogo ? <img src="assets/images/logo.png" alt="慧眼智检" style={{ width: 160 }} /> : null}
              <span className="spacer" />
              <Badge tone="blue">模板预览</Badge>
            </div>
            <h2 style={{ margin: "30px 0", textAlign: "center" }}>{title}</h2>
            <div className="detail-grid">
              <MetaItem label="任务编号">T***********</MetaItem>
              <MetaItem label="工单 / 盘号">由任务自动填充</MetaItem>
              <MetaItem label="检测项目">由适用项目自动填充</MetaItem>
              <MetaItem label="判定规则">生成时规则快照</MetaItem>
            </div>
            <div style={{ margin: "24px 0", padding: 20, background: "#f4f7fc", borderRadius: 6 }}>
              检测数据汇总
              {flags.includeTrend ? <p className="muted small">已启用：量测趋势</p> : null}
              {flags.includeAlarms ? <p className="muted small">已启用：报警与复核记录</p> : null}
              {flags.includeDetails ? <p className="muted small">已启用：全部量测明细</p> : null}
            </div>
            <p>{signatory}</p>
            <p className="muted small" style={{ borderTop: "1px solid #e7edf5", paddingTop: 20 }}>{footer}</p>
          </div>
        </Panel>
        <div className="stack">
          <Panel core title="模板信息">
            <div className="detail-grid">
              <MetaItem label="模板版本">{template.version || "V1.0"}</MetaItem>
              <MetaItem label="作用范围">三项检测报告</MetaItem>
              <MetaItem label="生成方式">按任务状态生成</MetaItem>
              <MetaItem label="历史报告"><Badge tone="green">保持原始快照</Badge></MetaItem>
            </div>
          </Panel>
          <Panel core title="内容组成">
            <div className="stack">
              {CONTENTS.map(text => (
                <div className="row" key={text}>
                  <Icon name="check" size={17} />
                  {text}
                  <span className="spacer" />
                  <Badge tone="gray">必备</Badge>
                </div>
              ))}
            </div>
          </Panel>
          <Note>签审栏是报告展示内容。原型不模拟有效电子签名或生产放行授权。</Note>
        </div>
      </div>
      <TemplateEditor store={store} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TemplateEditor({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const template = state.reportTemplate;
  const flags = templateFlags(template);

  return (
    <Modal
      title="编辑报告模板"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        store.saveTemplate({
          title: data.get("title"),
          signatory: data.get("signatory"),
          footer: data.get("footer"),
          includeLogo: data.has("includeLogo"),
          includeTrend: data.has("includeTrend"),
          includeAlarms: data.has("includeAlarms"),
          includeDetails: data.has("includeDetails")
        });
        toast("模板已保存，之后生成的报告将使用此版本。");
      }}
    >
      <div key={template.version || "V1.0"}>
        <Field label="报告抬头">
          <TextInput name="title" value={template.title || template.header || "高压电缆质量检测报告"} placeholder="填写报告标题" required />
        </Field>
        <Field label="签审栏">
          <TextInput name="signatory" value={template.signatory || template.reviewer || "复核人：____________"} aria-label="签审栏" />
        </Field>
        <Field label="页脚">
          <textarea name="footer" rows={4} aria-label="页脚" defaultValue={template.footer || "山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来"} />
        </Field>
        <div className="grid cols-2">
          <label className="row small"><input type="checkbox" name="includeLogo" defaultChecked={flags.includeLogo} /> 显示品牌 Logo</label>
          <label className="row small"><input type="checkbox" name="includeTrend" defaultChecked={flags.includeTrend} /> 显示量测趋势</label>
          <label className="row small"><input type="checkbox" name="includeAlarms" defaultChecked={flags.includeAlarms} /> 显示报警复核记录</label>
          <label className="row small"><input type="checkbox" name="includeDetails" defaultChecked={flags.includeDetails} /> 显示全部量测明细</label>
        </div>
      </div>
    </Modal>
  );
}
