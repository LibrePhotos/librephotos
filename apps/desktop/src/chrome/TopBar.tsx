import {
  IconAppWindow,
  IconArrowLeft,
  IconArrowsMinimize,
  IconCopy,
  IconEraser,
  IconFolderOpen,
  IconFolderPlus,
  IconInfoCircle,
  IconInfoCircleFilled,
  IconMaximize,
  IconMinimize,
  IconPhotoPlus,
  IconPlayerPlay,
  IconRotate,
  IconRotateClockwise,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUpload,
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
  library(): void;
  addFolderToLibrary?: () => void;
  uploadToServer?: () => void;
  toggleFavorite(): void;
};

type Props = {
  file: FileEntry | null;
  index: number;
  count: number;
  infoOpen: boolean;
  fullscreen: boolean;
  favorite: boolean | null;
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

function Title({ file, index, count }: { file: FileEntry | null; index: number; count: number }) {
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

export function TopBar({ file, index, count, infoOpen, fullscreen, favorite, actions, onPointerEnter, onPointerLeave }: Props) {
  const none = file === null;
  const video = file?.kind === "video";
  const noPicture = none || video;
  return (
    <header className="topbar" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <div className="topbar-start">
        <IconButton icon={IconArrowLeft} label="Library" shortcut="L" onClick={actions.library} />
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
          icon={favorite ? IconStarFilled : IconStar}
          label={favorite ? "Remove from favourites" : "Add to favourites"}
          shortcut="F"
          onClick={actions.toggleFavorite}
          disabled={noPicture || favorite === null}
          className={favorite ? "needs-file favorite-on" : "needs-file"}
        />
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
              {
                icon: IconFolderPlus,
                label: "Add this folder to library",
                onSelect: () => actions.addFolderToLibrary?.(),
                disabled: none || !actions.addFolderToLibrary,
              },
              {
                icon: IconUpload,
                label: "Upload to LibrePhotos",
                onSelect: () => actions.uploadToServer?.(),
                disabled: none || !actions.uploadToServer,
              },
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
