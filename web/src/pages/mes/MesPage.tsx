import { useState } from "react";
import { useSyncExternalStore } from "react";
import { DENY_ADMIN, isAdmin } from "../../auth/permissions";
import type { InspectionStore } from "../../domain/store";
import type { SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Drawer } from "../../ui/Drawer";
import { Field, Select, TextInput } from "../../ui/Field";
import { HashLink } from "../../ui/HashLink";
import { Kpi } from "../../ui/Kpi";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { fmt } from "../../ui/format";
import { MetaItem } from "../present";

const FLOW = [
  ["01", "平台接收", "采样记录进入平台，独立标记数据有效性。"],
  ["02", "推送量测数据", "使用唯一记录编号关联任务、盘号与规则快照。"],
  ["03", "MES 接收确认", "仅收到确认后标为已确认，失败记录可幂等重试。"]
];

const FIELDS = [
  ["幂等键", "recordId", "每条记录唯一，不因重试产生重复量测"],
  ["业务对象", "taskId / workOrder / reelId", "任务、工单与盘号分别传递"],
  ["量测结果", "metric / value / unit / validity", "原始量测值与数据有效性"],
  ["判定依据", "ruleSnapshot / judgement", "记录产生时的规则与数值判定"],
  ["采样位置", "time / meter", "保留事件时间和米数位置"],
  ["接收确认", "platformStatus / mesStatus / confirmedAt", "平台接收与 MES 确认独立追踪"]
];

const FALLBACK_ENDPOINT = "https://mes.example.local/api/quality";

export function MesPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const mes = state.mes;
  const records = store.currentRecords();
  const confirmed = records.filter(record => record.mesStatus === "confirmed").length;
  const pending = records.filter(record => record.mesStatus === "pending").length;
  const failed = records.filter(record => record.mesStatus === "failed").length;
  const enabled = mes.enabled !== false;
  const endpoint = mes.endpoint || mes.url || FALLBACK_ENDPOINT;
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);

  function openEditor() {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setEditing(true);
  }

  return (
    <>
      <PageTitle
        title="MES 接口配置"
        subtitle="管理质量数据推送规则、业务关联字段与接收确认。"
        actions={<Button primary icon="settings" onClick={openEditor}>编辑 MES 配置</Button>}
      />
      <div className="grid cols-3">
        <Kpi
          label="当前窗口确认比例"
          value={records.length ? `${fmt(confirmed / records.length * 100, 0)}%` : "—"}
          note={`${confirmed} / ${records.length} 条记录已确认`}
          icon="cloud-upload"
          tone="green"
        />
        <Kpi label="接口模式" value="本地模拟" note="不连接生产 MES" icon="plug" tone="blue" />
        <Kpi label="待同步 / 失败" value={`${pending} / ${failed}`} note="独立于检测任务执行状态" icon="refresh" tone="amber" />
      </div>
      <div className="split">
        <Panel core title="接口参数">
          <div className="detail-grid">
            <MetaItem label="推送地址"><code>{endpoint}</code></MetaItem>
            <MetaItem label="接口启用"><Badge tone={enabled ? "green" : "gray"}>{enabled ? "演示已启用" : "已停用"}</Badge></MetaItem>
            <MetaItem label="推送方式">{mes.mode === "batch" ? "任务批量推送" : "逐条记录推送"}</MetaItem>
            <MetaItem label="请求超时">{mes.timeout || 5000} ms</MetaItem>
            <MetaItem label="重试上限">{mes.retries === undefined ? 3 : mes.retries} 次</MetaItem>
            <MetaItem label="认证模式">模拟令牌（无真实凭据）</MetaItem>
          </div>
          <div className="toolbar">
            <Button icon="activity" onClick={() => setChecking(true)}>检查接口配置</Button>
            <HashLink route="sync">同步监控</HashLink>
          </div>
        </Panel>
        <Panel core title="交互流程">
          <div className="stack">
            {FLOW.map(row => (
              <div className="row" style={{ alignItems: "flex-start" }} key={row[0]}>
                <Badge tone="blue">{row[0]}</Badge>
                <div>
                  <strong>{row[1]}</strong>
                  <p className="muted small">{row[2]}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel core table title="数据推送与确认字段">
        <DataTable headers={["业务含义", "数据字段", "说明"]} rows={FIELDS} />
      </Panel>
      <Note>接口状态不代替检测状态或质量结论。此页面配置只影响本地模拟，未配置或发送真实认证凭据。</Note>
      <MesEditor store={store} open={editing} onClose={() => setEditing(false)} />
      <MesCheck open={checking} endpoint={endpoint} paused={mes.enabled === false} onClose={() => setChecking(false)} />
    </>
  );
}

function MesCheck({ open, endpoint, paused, onClose }: { open: boolean; endpoint: string; paused: boolean; onClose: () => void }) {
  const good = /^https?:\/\//i.test(endpoint);
  return (
    <Drawer title="MES 配置检查" open={open} onClose={onClose}>
      <DataTable
        headers={["检查项", "当前配置", "检查结果"]}
        rows={[
          ["地址格式", endpoint, <Badge tone={good ? "green" : "red"}>{good ? "格式有效" : "格式无效"}</Badge>],
          ["运行模式", "本地模拟，不发起外部请求", <Badge tone="blue">模拟</Badge>],
          ["接口开关", paused ? "已停用" : "已启用", <Badge tone={paused ? "amber" : "green"}>{paused ? "暂停推送" : "允许模拟推送"}</Badge>],
          ["幂等键", "record.id", <Badge tone="green">使用唯一记录编号</Badge>]
        ]}
      />
      <div style={{ marginTop: 20 }}>
        <Note>检查结果仅证明本地配置可用于演示，不证明外部 MES 服务可连接。</Note>
      </div>
    </Drawer>
  );
}

function MesEditor({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const mes = state.mes;
  const endpoint = mes.endpoint || mes.url || FALLBACK_ENDPOINT;

  return (
    <Modal
      title="编辑 MES 接口配置"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        const next = String(data.get("endpoint") || "").trim();
        if (!/^https?:\/\//i.test(next)) throw new Error("演示地址须为 http 或 https 地址。");
        store.saveMes({
          endpoint: next,
          mode: data.get("mode"),
          timeout: data.get("timeout"),
          retries: data.get("retries"),
          enabled: data.has("enabled")
        });
        toast("MES 配置已保存。");
      }}
    >
      <Field label="演示推送地址">
        <TextInput name="endpoint" type="text" value={endpoint} required aria-label="演示推送地址" />
      </Field>
      <Field label="推送方式">
        <Select name="mode" value={mes.mode === "batch" ? "batch" : "record"} options={[["record", "逐条记录推送"], ["batch", "任务批量推送"]]} />
      </Field>
      <Field label="请求超时 / ms">
        <TextInput name="timeout" type="number" value={mes.timeout || 5000} required min={1000} max={60000} step={500} aria-label="请求超时 / ms" />
      </Field>
      <Field label="重试上限">
        <TextInput name="retries" type="number" value={mes.retries === undefined ? 3 : mes.retries} required min={0} max={10} step={1} aria-label="重试上限" />
      </Field>
      <label className="row small">
        <input type="checkbox" name="enabled" defaultChecked={mes.enabled !== false} /> 启用 MES 同步演示
      </label>
      <Note>演示配置不发起任何外部请求，也不接受真实密钥。</Note>
    </Modal>
  );
}
