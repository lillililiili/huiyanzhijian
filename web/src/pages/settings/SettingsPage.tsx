import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { DENY_ADMIN, isAdmin } from "../../auth/permissions";
import type { InspectionStore } from "../../domain/store";
import type { SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field, Select, TextInput } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Kpi } from "../../ui/Kpi";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { MetaItem } from "../present";

const SCENARIOS: Array<[string, string, string, string, string]> = [
  ["normal", "正常演示", "恢复设备在线；已产生的无效和失败记录保留，可继续复核或重试。", "shield-check", "green"],
  ["offline", "设备离线", "模拟检测设备离线，检查连接状态与量测状态的区别。", "wifi-off", "amber"],
  ["invalid", "无效量测", "添加无效量测，验证缺失值不按零值进入统计。", "database-off", "amber"],
  ["mes-failure", "MES 同步失败", "产生待重试记录，验证数值判定与同步状态独立。", "cloud-off", "red"]
];

const SCENARIO_NAMES: Record<string, string> = {
  normal: "正常演示",
  offline: "设备离线",
  invalid: "无效量测",
  "mes-failure": "MES 同步失败"
};

export function SettingsPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const settings = state.settings;
  const summary = store.stats(state.records);
  const scenario = settings.scenario || "normal";
  const memoryOnly = store.memoryOnly;
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const online = state.devices.filter(device => device.status === "online").length;
  const unconfirmed = state.records.filter(record => record.mesStatus !== "confirmed").length;
  const unresolved = state.alarms.filter(alarm => alarm.status !== "resolved").length;

  function openEditor() {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setEditing(true);
  }

  function applyScenario(name: string) {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    store.setScenario(name);
    toast("已应用演示场景，可查看监控、历史数据及同步状态。");
  }

  function openReset() {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setResetting(true);
  }

  return (
    <>
      <PageTitle
        title="系统设置与运行状态"
        subtitle="设置本地演示偏好、检查数据状态并切换验收场景。"
        actions={<Button primary icon="settings" onClick={openEditor}>编辑系统设置</Button>}
      />
      <div className="grid cols-4">
        <Kpi label="运行环境" value="本地原型" note="HTML · CSS · JavaScript" icon="browser" />
        <Kpi label="当前场景" value={SCENARIO_NAMES[scenario] || "正常演示"} note="可通过下方卡片切换" icon="activity" tone="blue" />
        <Kpi label="数据有效性" value={`${summary.invalid} 条无效`} note={`${summary.valid} 条有效记录`} icon="database" tone={summary.invalid ? "amber" : "green"} />
        <Kpi
          label="存储方式"
          value={memoryOnly ? "内存模式" : "浏览器本地"}
          note={memoryOnly ? "当前浏览器存储不可用，关闭后不保留" : "刷新后保留演示修改"}
          icon="device-floppy"
          tone="green"
        />
      </div>
      <div className="split">
        <Panel core title="平台设置">
          <div className="detail-grid">
            <MetaItem label="平台名称">{settings.platformName || "慧眼智检 · 线缆质量管控平台"}</MetaItem>
            <MetaItem label="所属机构">{settings.organization || settings.company || "山东沉积岩信息科技有限公司"}</MetaItem>
            <MetaItem label="回放刷新间隔">{settings.refreshInterval || 5} 秒</MetaItem>
            <MetaItem label="默认分页大小">{settings.pageSize || 8} 条 / 页</MetaItem>
            <MetaItem label="数据范围">35–220 kV 高压电缆</MetaItem>
            <MetaItem label="检测范围">搭盖率 / 铜丝间隙 / 不圆度</MetaItem>
          </div>
        </Panel>
        <Panel core title="运行检查">
          <div className="stack">
            {[
              ["本地数据仓库", <Badge tone="green">可用</Badge>],
              ["登记检测设备", `${state.devices.length} 台`],
              ["在线设备", `${online} 台`],
              ["MES 未确认记录", `${unconfirmed} 条`],
              ["未完成复核事件", `${unresolved} 条`]
            ].map(row => (
              <div className="row" style={{ padding: "9px 0", borderBottom: "1px solid #eef2f7" }} key={String(row[0])}>
                <span className="muted">{row[0]}</span>
                <span className="spacer" />
                <strong>{row[1]}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel core title="演示场景">
        <div className="grid cols-4">
          {SCENARIOS.map(item => {
            const current = scenario === item[0];
            return (
              <div key={item[0]} style={{ padding: 20, border: "1px solid #e7edf5", borderRadius: 8 }}>
                <span className={`badge ${item[4]}`}><Icon name={item[3]} size={22} /></span>
                <h3>{item[1]}</h3>
                <p className="muted small" style={{ minHeight: 58 }}>{item[2]}</p>
                <Button primary={current} onClick={() => applyScenario(item[0])}>{current ? "重新应用" : "切换场景"}</Button>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel core title="演示数据管理">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div>
            <strong>恢复初始演示数据</strong>
            <p className="muted small">恢复 12 个任务、3 台设备、当前窗口 90 条有效记录与初始配置。清除当前浏览器的演示修改。</p>
          </div>
          <span className="spacer" />
          <Button icon="refresh" onClick={openReset}>恢复初始数据</Button>
        </div>
      </Panel>
      <Note>所有连接、账户和数据均为本地演示。设备离线不会改写历史测量，MES 故障不会自动变更质量判定。</Note>
      <SettingsEditor store={store} open={editing} onClose={() => setEditing(false)} />
      <Modal
        title="恢复初始演示数据"
        open={resetting}
        submitLabel="确认恢复"
        onClose={() => setResetting(false)}
        onSubmit={data => {
          if (!data.has("confirmReset")) throw new Error("请勾选确认后再恢复。");
          store.reset();
          navigate("dashboard");
          toast("已恢复初始演示数据。");
        }}
      >
        <Note tone="amber">当前浏览器中新建的任务、导入的数据、报警处置、报告与配置修改将被清除。项目源码和图片素材保留。</Note>
        <p>恢复后可以重新从初始场景演示全部流程。</p>
        <label className="row small">
          <input type="checkbox" name="confirmReset" /> 我已确认恢复初始演示数据
        </label>
      </Modal>
    </>
  );
}

function SettingsEditor({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const settings = state.settings;

  return (
    <Modal
      title="编辑系统设置"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        store.saveSettings({
          platformName: data.get("platformName"),
          organization: data.get("organization"),
          refreshInterval: data.get("refreshInterval"),
          pageSize: data.get("pageSize")
        });
        toast("系统设置已保存。");
      }}
    >
      <Field label="平台名称">
        <TextInput name="platformName" value={settings.platformName || "慧眼智检 · 线缆质量管控平台"} placeholder="填写平台名称" required />
      </Field>
      <Field label="所属机构">
        <TextInput name="organization" value={settings.organization || settings.company || "山东沉积岩信息科技有限公司"} placeholder="填写机构名称" required />
      </Field>
      <Field label="回放刷新间隔 / 秒">
        <Select name="refreshInterval" value={settings.refreshInterval || 5} options={[[2, "2 秒"], [5, "5 秒"], [10, "10 秒"], [30, "30 秒"]]} />
      </Field>
      <Field label="默认分页大小">
        <Select name="pageSize" value={settings.pageSize || 8} options={[[8, "8 条"], [10, "10 条"], [20, "20 条"]]} />
      </Field>
    </Modal>
  );
}
