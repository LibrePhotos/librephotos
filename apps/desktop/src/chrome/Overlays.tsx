import { IconAlertTriangle, IconCheck, IconFileUpload, IconPhotoPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "../ipc";
import "./Overlays.css";

// ---------------------------------------------------------------- delete confirmation

export function ConfirmDelete({
  file,
  onConfirm,
  onCancel,
}: {
  file: FileEntry;
  onConfirm(dontAskAgain: boolean): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // showModal() focuses the first control (the checkbox); Enter should confirm.
    confirmRef.current?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="confirm-title"
      onCancel={e => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={e => e.stopPropagation()}
      onClick={e => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={e => {
          e.preventDefault();
          onConfirm(dontAsk);
        }}
      >
        <h2 id="confirm-title">Move to Recycle Bin?</h2>
        <p className="dialog-file">{file.name}</p>
        <label className="check">
          <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
          <span>Don't ask again</span>
        </label>
        <div className="dialog-actions">
          <button ref={confirmRef} type="submit" className="btn primary">
            Delete
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- toasts

export type Toast = { id: number; text: string; tone: "info" | "error" };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = nextId.current++;
    setToasts(prev => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), tone === "error" ? 5000 : 2600);
  }, []);
  return { toasts, push };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === "error" ? <IconAlertTriangle size={16} stroke={1.75} /> : <IconCheck size={16} stroke={2} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- empty state and drop target

export function EmptyState({ error, onOpen }: { error: string | null; onOpen(): void }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-logo" aria-hidden="true">
          <IconPhotoPlus size={30} stroke={1.4} />
        </div>
        <h1>LibrePhotos Viewer</h1>
        <p className="empty-sub">Fast, private, local. Your pictures stay on this computer.</p>
        {error && (
          <p className="empty-error" role="alert">
            <IconAlertTriangle size={16} stroke={1.75} /> {error}
          </p>
        )}
        <button type="button" className="btn primary big" onClick={onOpen}>
          Open a picture
        </button>
        <p className="empty-hint">or drop one here</p>
      </div>
    </div>
  );
}

export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <IconFileUpload size={36} stroke={1.4} />
        <span>Drop to open</span>
      </div>
    </div>
  );
}
