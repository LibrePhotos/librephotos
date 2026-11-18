import {
  IconAlertTriangle,
  IconAperture,
  IconCalendar,
  IconCamera,
  IconClockEdit,
  IconDimensions,
  IconFile,
  IconFolder,
  IconMapPin,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { FileEntry, ImageInfo } from "../ipc";
import { cameraName, folderOf, formatBytes, formatCoordinate, formatMegapixels, formatModified, formatTaken } from "../lib/format";
import { useImageInfo } from "../lib/infoCache";
import { RemoteSection } from "../library/RemoteSection";
import "./InfoPanel.css";

function Row({ icon: I, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <I className="info-icon" size={18} stroke={1.5} aria-hidden="true" />
      <div className="info-body">
        <div className="info-label">{label}</div>
        <div className="info-value">{children}</div>
      </div>
    </div>
  );
}

function Details({ info }: { info: ImageInfo }) {
  const camera = cameraName(info.cameraMake, info.cameraModel);
  const chips = [info.exposure, info.fNumber, info.iso !== null ? `ISO ${info.iso}` : null, info.focalLength].filter(
    (c): c is string => c !== null && c !== "",
  );
  return (
    <>
      {info.takenAt ? (
        <Row icon={IconCalendar} label="Date taken">
          {formatTaken(info.takenAt)}
        </Row>
      ) : (
        <Row icon={IconClockEdit} label="Modified">
          {formatModified(info.modifiedMs)}
          <div className="info-sub">No date taken in this file</div>
        </Row>
      )}
      <Row icon={IconFile} label="File">
        <div className="info-strong">{info.name}</div>
        <div className="info-sub">
          {info.format} · {formatBytes(info.size)}
        </div>
      </Row>
      {info.width !== null && info.height !== null && (
        <Row icon={IconDimensions} label="Dimensions">
          {info.width.toLocaleString()} × {info.height.toLocaleString()}
          <span className="info-sub inline"> · {formatMegapixels(info.width, info.height)}</span>
        </Row>
      )}
      {(camera || info.lens || chips.length > 0) && (
        <Row icon={IconCamera} label="Camera">
          {camera && <div className="info-strong">{camera}</div>}
          {info.lens && <div className="info-sub">{info.lens}</div>}
          {chips.length > 0 && (
            <div className="chips">
              {chips.map(c => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
          )}
        </Row>
      )}
      {info.gps && (
        <Row icon={IconMapPin} label="Location">
          <span className="info-mono">
            {formatCoordinate(info.gps.lat, "N", "S")}, {formatCoordinate(info.gps.lon, "E", "W")}
          </span>
        </Row>
      )}
      <Row icon={IconFolder} label="Folder">
        <span className="info-path">{folderOf(info.path)}</span>
      </Row>
      {info.extra.length > 0 && (
        <Row icon={IconAperture} label="More">
          <dl className="info-extra">
            {info.extra.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="info-extra-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Row>
      )}
    </>
  );
}

function Skeleton() {
  return (
    <div className="info-skeleton" aria-busy="true" aria-label="Loading file info">
      {[70, 90, 55, 80, 65].map((w, i) => (
        <div key={i} className="sk-row">
          <div className="sk-icon" />
          <div className="sk-lines">
            <div className="sk-line short" />
            <div className="sk-line" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InfoPanel({ file, onClose }: { file: FileEntry; onClose(): void }) {
  const state = useImageInfo(file, 120);
  return (
    <aside className="info-panel" aria-label="File info">
      <div className="info-header">
        <h2>Info</h2>
        <button type="button" className="icon-btn" aria-label="Close info (I)" onClick={onClose}>
          <IconX size={16} stroke={1.75} />
        </button>
      </div>
      <div className="info-content">
        {state.status === "loading" && <Skeleton />}
        {state.status === "error" && (
          <div className="info-error" role="alert">
            <IconAlertTriangle size={20} stroke={1.5} />
            <div>
              <div className="info-strong">Couldn't read the file info</div>
              <div className="info-sub">{state.error}</div>
            </div>
          </div>
        )}
        {state.status === "ready" && <Details info={state.info} />}
        <RemoteSection file={file} />
      </div>
    </aside>
  );
}
