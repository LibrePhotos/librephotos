import {
  IconAppWindow,
  IconArrowsMinimize,
  IconCopy,
  IconDots,
  IconEraser,
  IconFolderOpen,
  IconFolderPlus,
  IconInfoCircle,
  IconLayoutGrid,
  IconMaximize,
  IconMinimize,
  IconPhotoPlus,
  IconPlayerPlay,
  IconRotate,
  IconRotateClockwise,
  IconTrash,
  IconUpload,
  IconZoomIn,
  IconZoomOut,
  type Icon,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../ipc";
import { useZoomPercent } from "../lib/zoomStore";
import "./TopBar.css";

export type TopBarActions = {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  toggleActual(): void;
  rotate(clockwise: boolean): void;
  remove(): void;
  copy(): void;
  reveal(): void;
  toggleInfo(): void;
  slideshow(): void;
  toggleFullscreen(): void;
  open(): void;
  setDefaultViewer(): void;
  clearCache(): void;
  /** Show the library (src/library). */
  library(): void;
  /** For a picture outside the library: add its folder. Undefined when it is in the library. */
  addFolderToLibrary?: () => void;
  /** Upload this one file to the connected LibrePhotos server. Undefined when not connected. */
  uploadToServer?: () => void;
};

type Props = {
  file: FileEntry | null;
  index: number;
  count: number;
  infoOpen: boolean;
  fullscreen: boolean;
  actions: TopBarActions;
  onPointerEnter(): void;
  onPointerLeave(): void;
};

type ButtonProps = {
  icon: Icon;
  label: string;
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
  tipEnd?: boolean;
  /** Hidden when the window is narrow: 1 below 900 px, 2 below 680 px. */
  optional?: 1 | 2;
};

export function IconButton({ icon: I, label, shortcut, onClick, disabled, pressed, tipEnd, optional }: ButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${pressed ? " pressed" : ""}${optional ? ` opt-${optional}` : ""}`}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      data-tip-end={tipEnd ? "" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <I size={18} stroke={1.6} />
    </button>
  );
}

function ZoomReadout({ onClick, disabled }: { onClick(): void; disabled: boolean }) {
  const percent = useZoomPercent();
  return (
    <button
      type="button"
      className="zoom-readout"
      aria-label="Toggle fit and 100 %"
      data-tip="Fit / 100 %  1"
      disabled={disabled || percent === null}
      onClick={onClick}
    >
      {percent === null ? "–" : `${percent}%`}
    </button>
  );
}

type MenuItem = {
  icon: Icon;
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Only listed when the toolbar button with the same `optional` level is hidden. */
  narrow?: 1 | 2;
  separatorBefore?: boolean;
};

/** "More options": less-used actions, plus the toolbar buttons a narrow window hides. */
function OverflowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    /** Enabled items that are shown (narrow-only items are display: none on wide windows). */
    const items = () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])].filter(
        b => b.offsetParent !== null,
      );
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close(false);
    };
    // While open, keys belong to the menu (capture phase: the viewer's shortcuts never see them).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.stopPropagation();
        if (e.key === "Escape") e.preventDefault();
        close(e.key === "Escape");
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        // Let the focused item's own click happen, but keep the viewer from seeing the key.
        e.stopPropagation();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
      const buttons = items();
      if (buttons.length === 0) return;
      const at = buttons.findIndex(b => b === document.activeElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const onBlur = () => close(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    items()[0]?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  return (
    <div className="overflow" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn${open ? " pressed" : ""}`}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : "More options"}
        data-tip-end=""
        onClick={() => setOpen(o => !o)}
      >
        <IconDots size={18} stroke={1.6} />
      </button>
      {open && (
        <div ref={menuRef} className="menu" role="menu" aria-label="More options">
          {items.map(({ icon: I, label, onSelect, disabled, narrow, separatorBefore }) => (
            <div key={label} className={narrow ? `menu-narrow-${narrow}` : undefined}>
              {separatorBefore && <div className="menu-sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  onSelect();
                }}
              >
                <I size={16} stroke={1.6} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ file, index, count, infoOpen, fullscreen, actions, onPointerEnter, onPointerLeave }: Props) {
  const none = file === null;
  const video = file?.kind === "video";
  return (
    <header className="topbar" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <IconButton icon={IconLayoutGrid} label="Library" shortcut="L" onClick={actions.library} />
      <div className="topbar-title">
        <span className="topbar-name" title={file?.path}>
          {file ? file.name : "LibrePhotos Viewer"}
        </span>
        {file && (
          <span className="topbar-count" aria-label={`Item ${index + 1} of ${count}`}>
            {index + 1} / {count}
          </span>
        )}
      </div>
      <div className="topbar-actions" role="toolbar" aria-label="Viewer actions">
        <div className="group opt-2">
          <IconButton icon={IconZoomOut} label="Zoom out" shortcut="-" onClick={actions.zoomOut} disabled={none || video} />
          <ZoomReadout onClick={actions.toggleActual} disabled={none || video} />
          <IconButton icon={IconZoomIn} label="Zoom in" shortcut="+" onClick={actions.zoomIn} disabled={none || video} />
          <IconButton icon={IconArrowsMinimize} label="Fit to window" shortcut="0" onClick={actions.fit} disabled={none || video} optional={1} />
        </div>
        <div className="sep opt-2" />
        <div className="group">
          <IconButton icon={IconRotate} label="Rotate left" shortcut="Shift+R" onClick={() => actions.rotate(false)} disabled={none || video} optional={2} />
          <IconButton icon={IconRotateClockwise} label="Rotate right" shortcut="R" onClick={() => actions.rotate(true)} disabled={none || video} optional={2} />
          <IconButton icon={IconTrash} label="Delete" shortcut="Del" onClick={actions.remove} disabled={none} />
          <IconButton icon={IconCopy} label="Copy" shortcut="Ctrl+C" onClick={actions.copy} disabled={none || video} optional={1} />
          <IconButton icon={IconFolderOpen} label="Show in folder" onClick={actions.reveal} disabled={none} optional={1} />
        </div>
        <div className="sep" />
        <div className="group">
          <IconButton icon={IconInfoCircle} label="File info" shortcut="I" onClick={actions.toggleInfo} disabled={none} pressed={infoOpen} tipEnd />
          <IconButton icon={IconPlayerPlay} label="Slideshow" shortcut="Space" onClick={actions.slideshow} disabled={none} tipEnd />
          <IconButton
            icon={fullscreen ? IconMinimize : IconMaximize}
            label={fullscreen ? "Exit full screen" : "Full screen"}
            shortcut="F11"
            onClick={actions.toggleFullscreen}
            tipEnd
          />
          <IconButton icon={IconPhotoPlus} label="Open" shortcut="Ctrl+O" onClick={actions.open} tipEnd />
          <OverflowMenu
            items={[
              { icon: IconRotate, label: "Rotate left", onSelect: () => actions.rotate(false), disabled: none || video, narrow: 2 },
              { icon: IconRotateClockwise, label: "Rotate right", onSelect: () => actions.rotate(true), disabled: none || video, narrow: 2 },
              { icon: IconCopy, label: "Copy", onSelect: actions.copy, disabled: none || video, narrow: 1 },
              { icon: IconFolderOpen, label: "Show in folder", onSelect: actions.reveal, disabled: none, narrow: 1 },
              { icon: IconFolderPlus, label: "Add this folder to library", onSelect: () => actions.addFolderToLibrary?.(), disabled: none || !actions.addFolderToLibrary, separatorBefore: true },
              { icon: IconUpload, label: "Upload to LibrePhotos", onSelect: () => actions.uploadToServer?.(), disabled: none || !actions.uploadToServer },
              { icon: IconAppWindow, label: "Set as default photo viewer", onSelect: actions.setDefaultViewer, separatorBefore: true },
              { icon: IconEraser, label: "Clear thumbnail cache", onSelect: actions.clearCache },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
