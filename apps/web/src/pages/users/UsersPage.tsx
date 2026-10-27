import { useState } from "react";
import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { setSessionUser } from "../../auth/session";
import { DENY_ADMIN, isAdmin } from "../../auth/permissions";
import type { InspectionStore } from "../../domain/store";
import type { Role, SessionUser, User } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { date } from "../../ui/format";

const ROLES: Record<Role, string> = {
  admin: "系统管理员",
  quality: "质量管理员",
  viewer: "只读观察员"
};

const ROLE_CARDS: Array<[Role, string, "blue" | "green" | "gray", string]> = [
  ["admin", "settings", "blue", "设备与接口、系统配置、用户管理及全部质量操作"],
  ["quality", "shield-check", "green", "检测任务、异常复核、规则配置与质量报告"],
  ["viewer", "eye", "gray", "查看全部演示数据、查询、打印与导出"]
];

const ROLE_OPTIONS = (Object.entries(ROLES) as Array<[Role, string]>);

function matchedUsers(users: readonly User[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return users.filter(item => {
    const text = [item.name, item.account, item.username, item.id].join(" ").toLowerCase();
    return (!filters.role || item.role === filters.role) && (!keyword || text.includes(keyword));
  });
}

export function UsersPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.users ?? {};
  const users = matchedUsers(state.users, filters);
  const [editing, setEditing] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);

  function openAdd() {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setEditing(null);
    setAdding(true);
  }

  function openEdit(target: User) {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setAdding(false);
    setEditing(target);
  }

  return (
    <>
      <PageTitle
        title="用户角色与权限"
        subtitle="三个演示角色分级使用本地平台；用户配置与操作审计关联。"
        actions={<Button primary icon="user-plus" onClick={openAdd}>新增用户</Button>}
      />
      <div className="grid cols-3">
        {ROLE_CARDS.map(([role, icon, tone, text]) => (
          <Panel key={role} core title={ROLES[role]}>
            <div className="row">
              <span className={`badge ${tone}`}><Icon name={icon} size={23} /></span>
              <strong style={{ fontSize: 30 }}>{state.users.filter(item => item.role === role).length}</strong>
              <span className="muted small">名用户</span>
            </div>
            <p className="muted small">{text}</p>
          </Panel>
        ))}
      </div>
      <FilterForm id="users">
        {current => (
          <>
            <Field label="姓名 / 账号">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入用户姓名或账号" />
            </Field>
            <Field label="角色">
              <Select name="role" value={current.role || ""} options={[["", "全部角色"], ...ROLE_OPTIONS]} />
            </Field>
          </>
        )}
      </FilterForm>
      <Panel core table={users.length > 0} title="用户列表">
        <DataTable
          headers={["姓名", "登录账号", "角色", "状态", "最近使用", "操作"]}
          rows={users.map(item => {
            const enabled = item.enabled !== false;
            return [
              item.name,
              item.account || item.username || item.id,
              <Badge tone={item.role === "admin" ? "blue" : item.role === "quality" ? "green" : "gray"}>{ROLES[item.role] || item.role}</Badge>,
              <Badge tone={enabled ? "green" : "gray"}>{enabled ? "已启用" : "已停用"}</Badge>,
              date(item.lastLogin),
              <Button icon="edit" onClick={() => openEdit(item)}>编辑用户</Button>
            ];
          })}
        />
      </Panel>
      <Note>{`当前身份：${user.name || "演示用户"} · ${ROLES[user.role] || "未登录"}。此处为本地原型权限，用户数据不构成真实身份认证。`}</Note>
      <UserEditor
        store={store}
        user={user}
        target={adding ? null : editing}
        open={adding || editing !== null}
        onClose={() => { setAdding(false); setEditing(null); }}
      />
    </>
  );
}

function UserEditor({ store, user, target, open, onClose }: { store: InspectionStore; user: SessionUser; target: User | null; open: boolean; onClose: () => void }) {
  return (
    <Modal
      title={target ? "编辑演示用户" : "新增演示用户"}
      open={open}
      onClose={onClose}
      onSubmit={data => {
        const saved = store.saveUser({
          id: target?.id,
          name: data.get("name"),
          account: data.get("account"),
          role: data.get("role"),
          enabled: data.get("enabled"),
          update: Boolean(target)
        });
        if (saved.id === user.id) {
          const next = { ...user, name: saved.name, role: saved.role };
          store.setSession(next);
          setSessionUser(next);
        }
        toast("用户配置已保存。");
      }}
    >
      <Field label="姓名">
        <TextInput name="name" value={target?.name || ""} placeholder="填写用户姓名" required />
      </Field>
      <Field label="登录账号">
        <TextInput name="account" value={target?.account || target?.username || ""} placeholder="例如 inspector01" required pattern="[A-Za-z0-9_.-]{3,40}" />
      </Field>
      <Field label="角色">
        <Select name="role" value={target?.role || "quality"} options={ROLE_OPTIONS} />
      </Field>
      <Field label="启用状态">
        <Select name="enabled" value={target?.enabled !== false ? "true" : "false"} options={[["true", "启用"], ["false", "停用"]]} />
      </Field>
      <Note>演示登录由页面选择角色，不设置或存储真实用户密码。</Note>
    </Modal>
  );
}
