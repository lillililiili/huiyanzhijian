import { canWrite, DENY_WRITE_CORE } from "../auth/permissions";
import type { SessionUser } from "../domain/types";
import { toast } from "../ui/Toast";

/** Page gate for task and spec writes. The store denies the same role again. */
export function refuseReadonly(user: SessionUser | null): boolean {
  if (canWrite(user)) return false;
  toast(DENY_WRITE_CORE);
  return true;
}
