import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import "./controls.css";

/**
 * Mantine's Modal with the web defaults (centred, 16px corners, 24px padding, a dimmed and softly
 * blurred backdrop), on a native <dialog>: the focus trap and Escape come with it.
 */
export function Modal({
  title,
  children,
  actions,
  onClose,
  width = 440,
}: {
  title: ReactNode;
  children: ReactNode;
  /** The buttons at the bottom right (Cancel, then the action). */
  actions: ReactNode;
  onClose(): void;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ "--modal-width": `${width}px` } as CSSProperties}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
    >
      <h2 className="modal-title">{title}</h2>
      <div className="modal-body">{children}</div>
      <div className="modal-actions">{actions}</div>
    </dialog>
  );
}
