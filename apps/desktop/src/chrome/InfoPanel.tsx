import {
  IconAlertTriangle,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconClockEdit,
  IconCopy,
  IconDeviceFloppy,
  IconFolder,
  IconMovie,
  IconPhoto,
} from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";
import type { FileEntry, FileKind, ImageInfo } from "../ipc";
import type { Photo } from "@librephotos/api-client/core";
import { useServerDetails } from "../edits/serverDetails";
import { TARGET_LABEL, useAppSettings, type MetadataTarget } from "../edits/settings";
import type { EditableState } from "../edits/useEditable";
import {
  baseName,
  cameraName,
  folderOf,
  formatBytes,
  formatDateParts,
  formatLatLon,
  formatMegapixels,
  pathParts,
} from "../lib/format";
import { useImageInfo } from "../lib/infoCache";
import { RemoteSection } from "../library/RemoteSection";
import { DetailRow, Panel, Section } from "../ui/Panel";
import { CaptionSection, DateEditor, InlineEdit, KeywordsSection, RatingStars } from "./edit/EditFields";
import { AlbumsSection, LocationSection, PeopleSection } from "./edit/PlaceAndServer";
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

type DetailsProps = {
  info: ImageInfo;
  kind: FileKind;
  takenAt: string | null;
  onDate: ((takenAt: string) => void) | null;
  onlineMaps: boolean;
  place: string | null;
  target: MetadataTarget;
};

function savedIn(info: ImageInfo, target: MetadataTarget): string {
  if (target === "app") return "Kept in this app's database; the file is not changed";
  if (target === "file") return info.writableInFile ? `Inside ${info.name}` : `Not possible for ${info.format} files`;
  return info.sidecar ? baseName(info.sidecar) : `${info.name}.xmp (made on the first edit)`;
}

function localIso(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function Details({ info, kind, takenAt, onDate, onlineMaps, place, target }: DetailsProps) {
  const [editingDate, setEditingDate] = useState(false);
  const camera = cameraName(info.cameraMake, info.cameraModel);
  // The web lightbox's order: ISO | mm | f | s.
  const chips = [info.iso !== null ? `ISO ${info.iso}` : null, info.focalLength, info.fNumber, info.exposure].filter(
    (c): c is string => c !== null && c !== "",
  );
  const taken = takenAt ? formatDateParts(takenAt) : formatDateParts(info.modifiedMs);
  const size =
    info.width !== null && info.height !== null
      ? [`${info.width.toLocaleString()} × ${info.height.toLocaleString()}`, formatMegapixels(info.width, info.height)]
      : [];
  const folder = folderOf(info.path);
  return (
    <>
      <Section title="Details">
        <DetailRow
          icon={takenAt ? IconCalendar : IconClockEdit}
          label={takenAt ? "Date taken" : "Modified"}
          title={
            onDate && !editingDate ? (
              <InlineEdit label="Edit date taken" onEdit={() => setEditingDate(true)}>
                <span data-testid="date-taken">{taken.date}</span>
              </InlineEdit>
            ) : (
              <span data-testid="date-taken">{taken.date}</span>
            )
          }
          sub={[taken.detail, !takenAt && "File modified date (no date taken in this file)"]}
        >
          {onDate && editingDate && (
            <DateEditor
              takenAt={takenAt ?? localIso(info.modifiedMs)}
              onCancel={() => setEditingDate(false)}
              onSave={value => {
                setEditingDate(false);
                onDate(value);
              }}
            />
          )}
        </DetailRow>
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
          <LocationSection
            lat={info.gps.lat}
            lon={info.gps.lon}
            place={place}
            onlineMaps={onlineMaps}
            copyButton={<CopyButton text={formatLatLon(info.gps.lat, info.gps.lon)} label="Copy coordinates" />}
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
        {kind !== "video" && (
          <DetailRow
            icon={IconDeviceFloppy}
            label="Edits are saved"
            title={TARGET_LABEL[target]}
            sub={[<span data-testid="saved-in">{savedIn(info, target)}</span>]}
          />
        )}
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

export function InfoPanel({
  file,
  onClose,
  editable,
  notify,
}: {
  file: FileEntry;
  onClose(): void;
  editable: EditableState;
  notify(text: string, tone?: "error"): void;
}) {
  const state = useImageInfo(file, 120);
  const [details, reloadDetails, setDetails] = useServerDetails(file);
  const [settings] = useAppSettings();
  const photo: Photo | null = details.status === "ready" ? details.photo : null;
  const albums = details.status === "ready" ? details.albums : null;
  const value = editable.value;
  const editableValue = file.kind !== "video" ? value : null;
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
      {state.status === "ready" && (
        <>
          {editableValue && (
            <CaptionSection
              key={file.path}
              caption={editableValue.caption}
              onSave={caption => void editable.save({ caption })}
            />
          )}
          {photo && <PeopleSection photo={photo} />}
          {editableValue && (
            <Section title="Rating">
              <RatingStars rating={editableValue.rating} onRate={editable.setRating} />
            </Section>
          )}
          <Details
            info={state.info}
            kind={file.kind}
            takenAt={value?.takenAt ?? state.info.takenAt}
            onDate={editableValue ? takenAt => void editable.save({ takenAt }) : null}
            onlineMaps={settings.onlineMaps}
            place={photo?.search_location ?? null}
            target={settings.metadataTarget}
          />
          {editableValue && (
            <KeywordsSection
              key={file.path}
              keywords={editableValue.keywords}
              onSave={keywords => void editable.save({ keywords })}
            />
          )}
          {photo && <AlbumsSection photo={photo} albums={albums} onChanged={reloadDetails} notify={notify} />}
        </>
      )}
      <RemoteSection file={file} details={details} setDetails={setDetails} />
    </Panel>
  );
}
