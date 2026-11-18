import {
  IconArrowsMinimize,
  IconCopy,
  IconFolderOpen,
  IconInfoCircle,
  IconMaximize,
  IconMinimize,
  IconPhotoPlus,
  IconPlayerPlay,
  IconRotate,
  IconRotateClockwise,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
  type Icon,
} from "@tabler/icons-react";
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

export function TopBar({ file, index, count, infoOpen, fullscreen, actions, onPointerEnter, onPointerLeave }: Props) {
  const none = file === null;
  const video = file?.kind === "video";
  return (
    <header className="topbar" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
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
        </div>
      </div>
    </header>
  );
}
