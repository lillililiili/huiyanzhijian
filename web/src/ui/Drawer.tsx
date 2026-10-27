import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useDialog } from "./useDialog";

type DrawerProps = {
  title: string;
  open: boolean;
  children: ReactNode;
  onClose: () => void;
};

export function Drawer({ title, open, children, onClose }: DrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialog(open, onClose, dialogRef, "button");
  if (!open) return null;
  return createPortal(
    <div className="drawer-overlay">
      <aside ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>,
    document.body
  );
}
