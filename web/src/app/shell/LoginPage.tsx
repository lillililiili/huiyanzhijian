import { useState, type FormEvent } from "react";
import { readRemembered, setSessionUser, writeRemembered } from "../../auth/session";
import { queueReturnAfterLogin } from "../hashRoute";
import type { InspectionStore } from "../../domain/store";
import type { User } from "../../domain/types";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";

const products = [
  ["dg", "金属屏蔽搭盖率", "≥ 10%"],
  ["jx", "铜丝屏蔽相邻铜丝间隙", "≤ 3mm"],
  ["by", "电缆不圆度", "≤ 8%"]
] as const;

const roleTabs = [
  ["admin", "质量管理员", "admin"],
  ["quality", "检测操作员", "operator"],
  ["viewer", "只读访客", "viewer"]
] as const;

export function LoginPage({ store, users }: { store: InspectionStore; users: User[] }) {
  const [remembered] = useState(() => readRemembered());
  const [account, setAccount] = useState(remembered);
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState<(typeof roleTabs)[number][0]>("admin");
  const [error, setError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);

  function applyRole(role: (typeof roleTabs)[number][0], username: string) {
    setLoginRole(role);
    setAccount(username);
    setPassword("demo1234");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const username = String(data.get("account") ?? "").trim();
    const user = users.find(item => item.username === username);
    if (!user || user.enabled === false) {
      setError("账号不存在或已停用，请选择演示身份。");
      return;
    }
    const next = { id: user.id, name: user.name, username: user.username, role: user.role };
    store.setSession(next);
    setSessionUser(next);
    writeRemembered(data.has("remember") ? username : null);
    store.log("登录系统", `以 ${user.role} 角色登录本地原型`);
    queueReturnAfterLogin();
  }

  return (
    <div className="login-page">
      <header className="login-top">
        <img src="assets/images/logo.png" alt="慧眼智检 AI线缆智能检测装备" />
        <span>35–220kV 高压电缆　 |　 三项关键指标量测</span>
      </header>
      <div className="login-stage">
        <section className="login-brand">
          <p className="eyebrow">电缆关键指标AI量测与质量数据解决方案</p>
          <h1>慧眼智检</h1>
          <h2>线缆质量管控平台</h2>
          <p className="brand-line">检测有据 · 质量可溯 · 数据可联</p>
          <div className="family-photo">
            <img src="assets/images/device-family.png" alt="慧眼智检三款智能检测装备，外观引用产品原型截图" />
          </div>
          <div className="login-products">
            {products.map(([id, name, value], index) => (
              <div key={id}>
                <strong>{name}</strong>
                <small>0{index + 1}</small>
                <em>{value}</em>
                <img src={`assets/images/metric-${id}.png`} alt={`${name}专题图标`} />
              </div>
            ))}
          </div>
        </section>
        <form className="login-form" id="login-form" onSubmit={submit}>
          <div className="login-shield">
            <Icon name="shield" size={27} />
          </div>
          <h2>欢迎登录</h2>
          <p>慧眼智检 · 线缆质量管控平台</p>
          <label className="login-label" htmlFor="login-account">账号</label>
          <div className="login-input">
            <Icon name="user" size={19} />
            <input id="login-account" name="account" autoComplete="username" required placeholder="请输入账号" value={account} onChange={event => setAccount(event.target.value)} />
          </div>
          <label className="login-label" htmlFor="login-password">密码</label>
          <div className="login-input">
            <Icon name="lock" size={19} />
            <input id="login-password" name="password" type="password" autoComplete="current-password" required minLength={4} placeholder="请输入密码（演示：任意4位以上）" value={password} onChange={event => setPassword(event.target.value)} />
          </div>
          <div className="login-options">
            <label>
              <input name="remember" type="checkbox" defaultChecked={remembered.length > 0} />
              记住账号
            </label>
            <button type="button" onClick={() => setContactOpen(true)}>联系管理员</button>
          </div>
          <div className="form-error" role="alert">{error}</div>
          <Button primary className="login-submit" type="submit">
            登录系统 <Icon name="arrow" size={21} />
          </Button>
          <div className="login-capabilities">
            <span><Icon name="monitor" size={17} />实时量测</span>
            <span><Icon name="bell" size={17} />阈值报警</span>
            <span><Icon name="cloud" size={17} />MES推送</span>
            <span><Icon name="history" size={17} />数据追溯</span>
          </div>
          <div className="login-demo">原型演示 · 不连接生产设备或MES · 选择演示身份</div>
          <div className="role-tabs">
            {roleTabs.map(([role, label, username]) => (
              <button key={role} type="button" className={loginRole === role ? "active" : undefined} onClick={() => applyRole(role, username)}>
                {label}
              </button>
            ))}
          </div>
        </form>
      </div>
      <footer className="login-bottom">
        <span>山东沉积岩信息科技有限公司</span>
        <strong>慧眼智检 · 质见未来</strong>
        <span>设备外观参考产品手册</span>
        <span>localhost 与 127.0.0.1 是不同的存储来源</span>
      </footer>
      <Modal title="联系管理员" open={contactOpen} submitLabel="知道了" onClose={() => setContactOpen(false)} onSubmit={() => undefined}>
        <Note>本地原型无需开通真实账号。可选择下方演示身份后登录。</Note>
        <p>所属机构：山东沉积岩信息科技有限公司</p>
        <p className="muted">管理员账号：admin；检测操作员：operator；只读账号：viewer。演示密码填写任意 4 位以上字符。</p>
      </Modal>
    </div>
  );
}
