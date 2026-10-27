import { useState } from "react";
import { useSyncExternalStore } from "react";
import { DENY_ADMIN, isAdmin } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
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
import { MetaItem } from "../present";

const PRINCIPLES = [
  "记录设备编号、任务、工单与盘号，禁止混用检测对象",
  "保留时间与米数位置，支持跨页面定位同一条记录",
  "缺失 / 无效量测单独标识，不按零值统计",
  "平台接收与 MES 确认独立记录"
];

const MAPPING = [
  ["record.id", "record_id", "唯一字符串", "用于幂等接收与追溯"],
  ["record.taskId / reelId", "task_id / reel_id", "关联编号", "必须与已登记的任务一致"],
  ["record.metric", "metric_code", "dg / jx / by", "仅接受三项检测"],
  ["record.time / meter", "measured_at / meter", "时间 / m", "保留采样顺序与位置"],
  ["record.value / validity", "value / validity", "数值 / valid、invalid", "缺失数据不转换成 0"],
  ["record.ruleSnapshot", "任务关联配方", "版本化规则", "按创建任务时规则判定"]
];

const FALLBACK_ENDPOINT = "http://127.0.0.1:8080/measurements";

export function ConnectionsPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const connections = state.connections;
  const online = state.devices.filter(device => device.status === "online").length;
  const endpoint = connections.endpoint || FALLBACK_ENDPOINT;
  const interval = connections.interval || connections.pollInterval || 1000;
  const heartbeat = Number(connections.heartbeat) || 30;
  const reconnect = connections.autoReconnect !== false;
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
        title="数据接入配置"
        subtitle="配置设备量测数据的本地接入演示与字段映射。"
        actions={<Button primary icon="settings" onClick={openEditor}>编辑接入配置</Button>}
      />
      <div className="grid cols-3">
        <Kpi label="接入设备" value={state.devices.length} note="三类检测设备独立关联" icon="plug" />
        <Kpi label="在线设备" value={online} note="连接状态与数据有效性分别记录" icon="wifi" tone="green" />
        <Kpi label="当前接入模式" value={connections.protocol || "HTTP"} note="本地模拟，无外部连接" icon="database" />
      </div>
      <div className="split">
        <Panel core title="连接配置">
          <div className="detail-grid">
            <MetaItem label="接入协议">{connections.protocol || "HTTP"}</MetaItem>
            <MetaItem label="演示地址"><code>{endpoint}</code></MetaItem>
            <MetaItem label="采样间隔">{interval} ms</MetaItem>
            <MetaItem label="心跳超时">{heartbeat} s</MetaItem>
            <MetaItem label="自动重连"><Badge tone={reconnect ? "green" : "gray"}>{reconnect ? "已启用" : "已关闭"}</Badge></MetaItem>
            <MetaItem label="执行环境"><Badge tone="blue">本地模拟</Badge></MetaItem>
          </div>
          <div className="toolbar">
            <Button icon="activity" onClick={() => setChecking(true)}>运行接入自检</Button>
            <HashLink route="devices">查看设备档案</HashLink>
          </div>
        </Panel>
        <Panel core title="采集原则">
          <div className="stack">
            {PRINCIPLES.map((text, index) => (
              <div className="row" style={{ alignItems: "flex-start" }} key={text}>
                <Badge tone="blue">0{index + 1}</Badge>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel core table title="量测字段映射">
        <DataTable headers={["平台字段", "设备字段", "格式", "处理约定"]} rows={MAPPING} />
      </Panel>
      <Note>自检只验证本地配置和模拟数据，不会向配置地址发送网络请求。</Note>
      <ConnectionEditor store={store} open={editing} onClose={() => setEditing(false)} />
      <Drawer title="数据接入自检结果" open={checking} onClose={() => setChecking(false)}>
        <Note>已检查本地设备状态、关联关系和最近记录。此自检未发起外部网络请求。</Note>
        <DataTable
          headers={["设备编号", "检测类型", "连接检查", "最近记录", "数据检查"]}
          rows={state.devices.map(device => {
            const latest = state.records.filter(record => record.deviceId === device.id).at(-1);
            const onlineDevice = device.status === "online";
            return [
              device.id,
              METRICS[device.metric].short,
              <Badge tone={onlineDevice ? "green" : "red"}>{onlineDevice ? "模拟连接正常" : "设备离线"}</Badge>,
              latest ? latest.id : "暂无采样",
              latest
                ? <Badge tone={latest.validity === "valid" ? "green" : "amber"}>{latest.validity === "valid" ? "字段完整 / 有效" : "已标记无效"}</Badge>
                : <Badge tone="gray">等待任务数据</Badge>
            ];
          })}
        />
      </Drawer>
    </>
  );
}

function ConnectionEditor({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const connections = state.connections;
  const endpoint = connections.endpoint || FALLBACK_ENDPOINT;
  const interval = connections.interval || connections.pollInterval || 1000;
  const heartbeat = Number(connections.heartbeat) || 30;

  return (
    <Modal
      title="编辑数据接入配置"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        store.saveConnections({
          protocol: data.get("protocol"),
          endpoint: data.get("endpoint"),
          interval: data.get("interval"),
          heartbeat: data.get("heartbeat"),
          autoReconnect: data.has("autoReconnect")
        });
        toast("接入配置已保存。");
      }}
    >
      <Field label="接入协议">
        <Select name="protocol" value={connections.protocol || "HTTP"} options={[["HTTP", "HTTP / JSON"], ["MQTT", "MQTT"], ["OPC UA", "OPC UA"]]} />
      </Field>
      <Field label="演示接入地址">
        <TextInput name="endpoint" value={endpoint} placeholder="填写演示地址" required />
      </Field>
      <Field label="采样间隔 / ms">
        <TextInput name="interval" type="number" value={interval} required min={100} max={60000} step={100} aria-label="采样间隔 / ms" />
      </Field>
      <Field label="心跳超时 / s">
        <TextInput name="heartbeat" type="number" value={heartbeat} required min={1} max={300} aria-label="心跳超时 / s" />
      </Field>
      <label className="row small">
        <input type="checkbox" name="autoReconnect" defaultChecked={connections.autoReconnect !== false} /> 启用自动重连演示
      </label>
      <Note>仅保存模拟配置，不连接生产设备或外部服务。</Note>
    </Modal>
  );
}
