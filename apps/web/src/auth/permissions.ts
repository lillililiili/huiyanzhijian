import type { SessionUser } from "../domain/types";

export const DENY_WRITE_CORE = "当前为只读角色，请切换质量管理员或检测操作员后操作";
export const DENY_WRITE = "当前角色为只读，不能修改演示数据。";
export const DENY_ADMIN = "此操作需要系统管理员角色，请切换演示身份。";
export const DENY_RECORD_RETRY = "当前角色为只读";

export function canWrite(user: SessionUser | null) {
  return !!user && user.role !== "viewer";
}

export function isAdmin(user: SessionUser | null) {
  return user?.role === "admin";
}

export function roleBadge(role: string): [string, "blue" | "green" | "gray"] {
  if (role === "admin") return ["系统管理员", "blue"];
  if (role === "quality") return ["质量管理员", "green"];
  if (role === "viewer") return ["只读查看者", "gray"];
  return [role, "gray"];
}
