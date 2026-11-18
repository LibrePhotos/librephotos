import {
  IconAlertTriangle,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconClockEdit,
  IconCopy,
  IconFolder,
  IconMapPin,
  IconMovie,
  IconPhoto,
} from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";
import type { FileEntry, FileKind, ImageInfo } from "../ipc";
import {
  baseName,
  cameraName,
  folderOf,
  formatBytes,
  formatCoordinate,
  formatDateParts,
  formatLatLon,
  formatMegapixels,
  pathParts,
} from "../lib/format";
import { useImageInfo } from "../lib/infoCache";
import { RemoteSection } from "../library/RemoteSection";
import { DetailRow, Panel, Section } from "../ui/Panel";
import "./InfoPanel.css";

const KIND_LABEL: Record<FileKind, string> = { image: "Photo", raw: "RAW photo", video: "Video" };

/** A small copy button after a value: a check for a moment once it is on the clipboard. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(timer);
  }, [done]);
  const I = done ? IconCheck : IconCopy;
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={label}
      data-tip={done ? "Copied" : label}
      data-tip-end=""
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setDone(true),
          () => undefined,
        );
      }}
    >
      <I size={14} stroke={1.75} aria-hidden="true" />
    </button>
  );
}

function Details({ info, kind }: { info: ImageInfo; kind: FileKind }) {
  const camera = cameraName(info.cameraMake, info.cameraModel);
  // The web lightbox's order: ISO | mm | f | s.
  const chips = [info.iso !== null ? `ISO ${info.iso}` : null, info.focalLength, info.fNumber, info.exposure].filter(
    (c): c is string => c !== null && c !== "",
  );
  const taken = info.takenAt ? formatDateParts(info.takenAt) : formatDateParts(info.modifiedMs);
  const size =
    info.width !== null && info.height !== null
      ? [`${info.width.toLocaleString()} × ${info.height.toLocaleString()}`, formatMegapixels(info.width, info.height)]
      : [];
  const folder = folderOf(info.path);
  return (
    <>
      <Section title="Details">
        <DetailRow
          icon={info.takenAt ? IconCalendar : IconClockEdit}
          label={info.takenAt ? "Date taken" : "Modified"}
          title={taken.date}
          sub={[taken.detail, !info.takenAt && "File modified date (no date taken in this file)"]}
        />
        <DetailRow
          icon={kind === "video" ? IconMovie : IconPhoto}
          label="File"
          title={<span className="info-file-name">{info.name}</span>}
          sub={[
            <span className="dot-list">
              {[...size, formatBytes(info.size)].map(part => (
                <span key={part}>{part}</span>
              ))}
            </span>,
            <span className="dot-list">
              <span>{info.format}</span>
              <span>{KIND_LABEL[kind]}</span>
            </span>,
          ]}
        />
        {(camera || info.lens || chips.length > 0) && (
          <DetailRow icon={IconCamera} label="Camera" title={camera ?? "Camera"} sub={[info.lens]}>
            {chips.length > 0 && (
              <ul className="chip-strip" aria-label="Exposure">
                {chips.map(c => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </DetailRow>
        )}
        {info.gps && (
          <DetailRow
            icon={IconMapPin}
            label="Location"
            title={`${formatCoordinate(info.gps.lat, "N", "S")}, ${formatCoordinate(info.gps.lon, "E", "W")}`}
            sub={[
              <>
                <span className="info-mono">{formatLatLon(info.gps.lat, info.gps.lon)}</span>
                <CopyButton text={formatLatLon(info.gps.lat, info.gps.lon)} label="Copy coordinates" />
              </>,
            ]}
          />
        )}
        <DetailRow
          icon={IconFolder}
          label="Folder"
          title={baseName(folder)}
          sub={[
            <span className="info-path" title={folder}>
              {pathParts(folder).map((part, i) => (
                <Fragment key={i}>
                  {part}
                  <wbr />
                </Fragment>
              ))}
            </span>,
          ]}
        />
      </Section>
      {info.extra.length > 0 && (
        <Section title="Metadata">
          <dl className="info-extra">
            {info.extra.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="info-extra-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </>
  );
}

function Skeleton() {
  return (
    <Section title="Details">
      <div className="info-skeleton" aria-busy="true" aria-label="Loading file info">
        {[55, 80, 65, 70].map((w, i) => (
          <div key={i} className="sk-row">
            <div className="skeleton sk-icon" />
            <div className="sk-lines">
              <div className="skeleton sk-line" style={{ width: `${w}%` }} />
              <div className="skeleton sk-line short" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function InfoPanel({ file, onClose }: { file: FileEntry; onClose(): void }) {
  const state = useImageInfo(file, 120);
  return (
    <Panel title="Info" label="File info" onClose={onClose} closeLabel="Close info (I)" className="info-panel lp-dark">
      {state.status === "loading" && <Skeleton />}
      {state.status === "error" && (
        <div className="info-error" role="alert">
          <IconAlertTriangle size={20} stroke={1.5} aria-hidden="true" />
          <div>
            <div className="detail-title">Couldn't read the file info</div>
            <div className="detail-sub">{state.error}</div>
          </div>
        </div>
      )}
      {state.status === "ready" && <Details info={state.info} kind={file.kind} />}
      <RemoteSection file={file} />
    </Panel>
  );
}
