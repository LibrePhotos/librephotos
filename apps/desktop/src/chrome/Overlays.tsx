import { IconAlertTriangle, IconAppWindow, IconCheck, IconFileUpload, IconPhotoPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "../ipc";
import { IconButton } from "../ui/IconButton";
import { Logo } from "../ui/Logo";
import "./Overlays.css";

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
        <div className="dialog-head">
          <span className="dialog-icon" aria-hidden="true">
            <IconTrash size={20} stroke={1.75} />
          </span>
          <h2 id="confirm-title">Move to Recycle Bin?</h2>
        </div>
        <p className="dialog-file">{file.name}</p>
        <label className="check">
          <input className="lp-checkbox" type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
          <span>Don't ask again</span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="submit" className="btn danger">
            Delete
          </button>
        </div>
      </form>
    </dialog>
  );
}

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
          <span className="toast-icon" aria-hidden="true">
            {t.tone === "error" ? <IconAlertTriangle size={18} stroke={2} /> : <IconCheck size={18} stroke={2.25} />}
          </span>
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

const DEFAULT_HINT_KEY = "lpview.defaultViewerHint.dismissed";
const isWindows = navigator.userAgent.includes("Windows");

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DEFAULT_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DEFAULT_HINT_KEY, "1");
  } catch {
  }
}

function DefaultViewerHint({ onSetDefault }: { onSetDefault(): void }) {
  const [visible, setVisible] = useState(() => isWindows && !readDismissed());
  if (!visible) return null;
  const dismiss = () => {
    writeDismissed();
    setVisible(false);
  };
  return (
    <div className="default-hint" role="note">
      <IconAppWindow size={20} stroke={1.5} aria-hidden="true" />
      <div className="default-hint-text">
        <span>Open pictures from File Explorer with LibrePhotos Viewer?</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            dismiss();
            onSetDefault();
          }}
        >
          Set as default photo viewer
        </button>
      </div>
      <IconButton icon={IconX} label="Dismiss" onClick={dismiss} size="sm" noTip className="dimmed" />
    </div>
  );
}

export function EmptyState({ error, onOpen, onSetDefault }: { error: string | null; onOpen(): void; onSetDefault(): void }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <Logo size={56} className="empty-logo" />
        <h1>LibrePhotos Viewer</h1>
        <p className="empty-sub">Fast, private, local. Your pictures stay on this computer.</p>
        {error && (
          <p className="empty-error" role="alert">
            <IconAlertTriangle size={18} stroke={1.75} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        <button type="button" className="btn primary big" onClick={onOpen}>
          <IconPhotoPlus size={20} stroke={1.75} aria-hidden="true" />
          Open a picture
        </button>
        <p className="empty-hint">
          or drop one here · <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">O</kbd>
        </p>
      </div>
      <DefaultViewerHint onSetDefault={onSetDefault} />
    </div>
  );
}

export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <IconFileUpload size={40} stroke={1.5} />
        <span>Drop to open</span>
      </div>
    </div>
  );
}
