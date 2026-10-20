import { Icon } from "./Icon";

export function Empty({ text = "暂无数据" }: { text?: string }) {
  return (
    <div className="empty">
      <Icon name="database" size={32} />
      <strong>{text}</strong>
      <span>调整查询条件，或创建一条新的记录</span>
    </div>
  );
}
