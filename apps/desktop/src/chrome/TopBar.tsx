import {
  IconAppWindow,
  IconArrowsMinimize,
  IconCopy,
  IconEraser,
  IconFolderOpen,
  IconInfoCircle,
  IconInfoCircleFilled,
  IconMaximize,
  IconMinimize,
  IconPhotoPlus,
  IconPlayerPlay,
  IconRotate,
  IconRotateClockwise,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import type { FileEntry } from "../ipc";
import { formatShortDate } from "../lib/format";
import { useImageInfo } from "../lib/infoCache";
import { useZoomPercent } from "../lib/zoomStore";
import { IconButton } from "../ui/IconButton";
import { Logo } from "../ui/Logo";
import { Menu } from "../ui/Menu";
import "./TopBar.css";

export { IconButton };

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

/** The centred title, as the web lightbox has it: the name, then the date taken and the position. */
function Title({ file, index, count }: { file: FileEntry | null; index: number; count: number }) {
  // The stage asks for the same info (zoom to 100 %); the cache shares the one request.
  const info = useImageInfo(file);
  if (!file) {
    return (
      <div className="topbar-title brand">
        <Logo size={24} />
        <span className="topbar-name">LibrePhotos</span>
      </div>
    );
  }
  const taken = info.status === "ready" && info.info.takenAt ? formatShortDate(info.info.takenAt) : null;
  return (
    <div className="topbar-title">
      <span className="topbar-name" title={file.path}>
        {file.name}
      </span>
      <span className="topbar-meta">
        {taken && <span className="topbar-date">{taken}</span>}
        <span className="topbar-count" aria-label={`Item ${index + 1} of ${count}`}>
          {index + 1} of {count}
        </span>
      </span>
    </div>
  );
}

/**
 * The viewer's toolbar, laid out like the web lightbox's: Open and the zoom controls on the left,
 * the picture's name, date and position in the middle, the most used actions on the right (Info and
 * Delete last, as on the web) and a ⋮ menu with the rest. Narrow windows move buttons into the menu
 * (.opt-1 below 900 px, .opt-2 below 680 px); every action keeps its keyboard shortcut.
 */
export function TopBar({ file, index, count, infoOpen, fullscreen, actions, onPointerEnter, onPointerLeave }: Props) {
  const none = file === null;
  const video = file?.kind === "video";
  const noPicture = none || video;
  return (
    <header className="topbar" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <div className="topbar-start">
        <IconButton icon={IconPhotoPlus} label="Open" shortcut="Ctrl+O" onClick={actions.open} />
        <div className="zoom-group needs-file opt-2" role="group" aria-label="Zoom">
          <IconButton icon={IconZoomOut} label="Zoom out" shortcut="-" onClick={actions.zoomOut} disabled={noPicture} />
          <ZoomReadout onClick={actions.toggleActual} disabled={noPicture} />
          <IconButton icon={IconZoomIn} label="Zoom in" shortcut="+" onClick={actions.zoomIn} disabled={noPicture} />
        </div>
      </div>
      <Title file={file} index={index} count={count} />
      <div className="topbar-actions" role="toolbar" aria-label="Viewer actions">
        <IconButton
          icon={IconRotateClockwise}
          label="Rotate right"
          shortcut="R"
          onClick={() => actions.rotate(true)}
          disabled={noPicture}
          optional={1}
          className="needs-file"
        />
        <IconButton
          icon={IconPlayerPlay}
          label="Slideshow"
          shortcut="Space"
          onClick={actions.slideshow}
          disabled={none}
          optional={1}
          className="needs-file"
        />
        <IconButton
          icon={fullscreen ? IconMinimize : IconMaximize}
          label={fullscreen ? "Exit full screen" : "Full screen"}
          shortcut="F11"
          onClick={actions.toggleFullscreen}
          optional={2}
          className="needs-file"
        />
        <IconButton
          icon={infoOpen ? IconInfoCircleFilled : IconInfoCircle}
          label="Info"
          shortcut="I"
          onClick={actions.toggleInfo}
          disabled={none}
          pressed={infoOpen}
          tipEnd
          className="needs-file"
        />
        <IconButton
          icon={IconTrash}
          label="Delete"
          shortcut="Del"
          onClick={actions.remove}
          disabled={none}
          tipEnd
          className="needs-file"
        />
        <Menu
          label="More options"
          groups={[
            [
              { icon: IconPlayerPlay, label: "Slideshow", shortcut: "Space", onSelect: actions.slideshow, disabled: none, className: "menu-narrow-1" },
              {
                icon: fullscreen ? IconMinimize : IconMaximize,
                label: fullscreen ? "Exit full screen" : "Full screen",
                shortcut: "F11",
                onSelect: actions.toggleFullscreen,
                className: "menu-narrow-2",
              },
              { icon: IconZoomIn, label: "Zoom in", shortcut: "+", onSelect: actions.zoomIn, disabled: noPicture, className: "menu-narrow-2" },
              { icon: IconZoomOut, label: "Zoom out", shortcut: "-", onSelect: actions.zoomOut, disabled: noPicture, className: "menu-narrow-2" },
              { icon: IconArrowsMinimize, label: "Fit to window", shortcut: "0", onSelect: actions.fit, disabled: noPicture },
              { icon: IconRotateClockwise, label: "Rotate right", shortcut: "R", onSelect: () => actions.rotate(true), disabled: noPicture, className: "menu-narrow-1" },
              { icon: IconRotate, label: "Rotate left", shortcut: "Shift+R", onSelect: () => actions.rotate(false), disabled: noPicture },
            ],
            [
              { icon: IconCopy, label: "Copy", shortcut: "Ctrl+C", onSelect: actions.copy, disabled: noPicture },
              { icon: IconFolderOpen, label: "Show in folder", onSelect: actions.reveal, disabled: none },
            ],
            [
              { icon: IconAppWindow, label: "Set as default photo viewer", onSelect: actions.setDefaultViewer },
              { icon: IconEraser, label: "Clear thumbnail cache", onSelect: actions.clearCache },
            ],
          ]}
        />
      </div>
    </header>
  );
}
