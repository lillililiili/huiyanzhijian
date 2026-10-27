import type { Role, SessionUser } from "../domain/types";

export const SESSION_KEY = "hy-web-session-v1";
export const REMEMBER_KEY = "hy-web-remember-account";

const unset = Symbol("unset");
let cached: SessionUser | null | typeof unset = unset;
const listeners = new Set<() => void>();

function storageOf(kind: "sessionStorage" | "localStorage"): Storage | null {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "quality" || value === "viewer";
}

function readStored(): SessionUser | null {
  const storage = storageOf("sessionStorage");
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSION_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<SessionUser>;
    if (!isRole(record.role) || typeof record.id !== "string" || typeof record.name !== "string" || typeof record.username !== "string") {
      return null;
    }
    return { id: record.id, name: record.name, username: record.username, role: record.role };
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function getSession() {
  if (cached === unset) cached = readStored();
  return cached;
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSessionUser(user: SessionUser | null) {
  cached = user;
  const storage = storageOf("sessionStorage");
  if (storage) {
    if (user) storage.setItem(SESSION_KEY, JSON.stringify(user));
    else storage.removeItem(SESSION_KEY);
  }
  emit();
}

export function readRemembered() {
  const storage = storageOf("localStorage");
  if (!storage) return "";
  try {
    return storage.getItem(REMEMBER_KEY) || "";
  } catch {
    return "";
  }
}

export function writeRemembered(account: string | null) {
  const storage = storageOf("localStorage");
  if (!storage) return;
  try {
    if (account) storage.setItem(REMEMBER_KEY, account);
    else storage.removeItem(REMEMBER_KEY);
  } catch {
    /* The prototype keeps the session when local storage is blocked. */
  }
}
