import type { Photo, UserAlbumInfo } from "@librephotos/api-client/core";
import { IconExternalLink, IconLibraryPhoto, IconMapPin, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openExternal } from "../../ipc";
import { errorText } from "../../lib/infoCache";
import { formatCoordinate, formatLatLon } from "../../lib/format";
import { addToServerAlbum, createServerAlbum, fetchAlbumList } from "../../library/serverApi";
import { Button } from "../../ui/Button";
import { Avatar } from "../../ui/Display";
import { TextInput } from "../../ui/Inputs";
import { Modal } from "../../ui/Modal";
import { DetailRow, Section } from "../../ui/Panel";
import "./Edit.css";

const TILE = 256;
const ZOOM = 14;

export function mapLink(lat: number, lon: number): string {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=16/${la}/${lo}`;
}

export function tileOf(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

function TileMap({ lat, lon }: { lat: number; lon: number }) {
  const { x, y } = tileOf(lat, lon, ZOOM);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const n = 2 ** ZOOM;
  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = (((cx + dx) % n) + n) % n;
      const ty = cy + dy;
      if (ty < 0 || ty >= n) continue;
      tiles.push(
        <img
          key={`${dx},${dy}`}
          className="map-tile"
          alt=""
          draggable={false}
          src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
          style={{
            left: `calc(50% + ${(cx + dx - x) * TILE}px)`,
            top: `calc(50% + ${(cy + dy - y) * TILE}px)`,
          }}
        />,
      );
    }
  }
  return (
    <div className="map-box" role="img" aria-label="Map of where the picture was taken">
      {tiles}
      <IconMapPin className="map-pin" size={30} stroke={2} aria-hidden="true" />
      <span className="map-credit">© OpenStreetMap contributors</span>
    </div>
  );
}

export function LocationSection({
  lat,
  lon,
  place,
  onlineMaps,
  copyButton,
}: {
  lat: number;
  lon: number;
  place: string | null;
  onlineMaps: boolean;
  copyButton: ReactNode;
}) {
  const open = () => void openExternal(mapLink(lat, lon)).catch(() => undefined);
  return (
    <DetailRow
      icon={IconMapPin}
      label="Location"
      title={place ?? `${formatCoordinate(lat, "N", "S")}, ${formatCoordinate(lon, "E", "W")}`}
      sub={[
        <>
          <span className="info-mono">{formatLatLon(lat, lon)}</span>
          {copyButton}
        </>,
        <button type="button" className="map-link" onClick={open}>
          <IconExternalLink size={13} stroke={1.75} aria-hidden="true" />
          Open in map
        </button>,
      ]}
    >
      {onlineMaps && <TileMap lat={lat} lon={lon} />}
    </DetailRow>
  );
}

export function PeopleSection({ photo }: { photo: Photo }) {
  const people = photo.people;
  if (people.length === 0) return null;
  return (
    <Section title="People">
      <ul className="people-list" data-testid="people-list">
        {people.map(p => (
          <li key={p.face_id} className="people-item">
            <Avatar name={p.name || "?"} size={32} />
            <span>{p.name || "Unknown"}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AlbumRow({ album }: { album: UserAlbumInfo }) {
  return (
    <>
      <IconLibraryPhoto className="album-icon" size={20} stroke={1.5} aria-hidden="true" />
      <span className="album-text">
        <span className="album-title">{album.title}</span>
        <span className="album-count">
          {album.photo_count.toLocaleString()} {album.photo_count === 1 ? "item" : "items"}
        </span>
      </span>
    </>
  );
}

export function AlbumsSection({
  photo,
  albums,
  onChanged,
  notify,
}: {
  photo: Photo;
  albums: UserAlbumInfo[] | null;
  onChanged(): void;
  notify(text: string, tone?: "error"): void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <section className="section" aria-label="Albums">
      <h3 className="section-title">Albums</h3>
      {albums && albums.length > 0 && (
        <ul className="album-list" data-testid="album-list">
          {albums.map(a => (
            <li key={a.id} className="album-item">
              <AlbumRow album={a} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="compact" variant="light" leftIcon={IconPlus} onClick={() => setPicking(true)}>
          Add to album
        </Button>
      </div>
      {picking && (
        <AddToAlbum
          photoId={photo.id}
          inAlbums={new Set((albums ?? []).map(a => a.id))}
          onClose={() => setPicking(false)}
          onAdded={title => {
            setPicking(false);
            notify(`Added to ${title}`);
            onChanged();
          }}
          onError={text => notify(text, "error")}
        />
      )}
    </section>
  );
}

function AddToAlbum({
  photoId,
  inAlbums,
  onClose,
  onAdded,
  onError,
}: {
  photoId: string;
  inAlbums: Set<number>;
  onClose(): void;
  onAdded(title: string): void;
  onError(text: string): void;
}) {
  const [albums, setAlbums] = useState<UserAlbumInfo[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    let live = true;
    fetchAlbumList().then(
      list => live && setAlbums(list),
      (err: unknown) => {
        if (!live) return;
        setAlbums([]);
        errorRef.current(`Couldn't load your albums: ${errorText(err)}`);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (albums ?? []).filter(a => !inAlbums.has(a.id) && (q === "" || a.title.toLowerCase().includes(q)));
  }, [albums, filter, inAlbums]);
  const exact = (albums ?? []).some(a => a.title.trim().toLowerCase() === filter.trim().toLowerCase());
  const run = (title: string, call: () => Promise<void>) => {
    setBusy(true);
    call().then(
      () => onAdded(title),
      (err: unknown) => {
        setBusy(false);
        onError(`Couldn't add it to ${title}: ${errorText(err)}`);
      },
    );
  };
  return (
    <Modal
      title="Add to album"
      onClose={onClose}
      actions={
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <TextInput
        label="Album"
        placeholder="Search or name a new album"
        value={filter}
        autoFocus
        onChange={e => setFilter(e.target.value)}
      />
      <ul className="album-picker" aria-busy={albums === null || busy}>
        {filter.trim() !== "" && !exact && (
          <li>
            <button
              type="button"
              className="album-pick"
              disabled={busy}
              onClick={() => run(filter.trim(), () => createServerAlbum(filter.trim(), photoId))}
            >
              <IconPlus className="album-icon" size={20} stroke={1.5} aria-hidden="true" />
              <span className="album-text">
                <span className="album-title">New album "{filter.trim()}"</span>
              </span>
            </button>
          </li>
        )}
        {shown.map(a => (
          <li key={a.id}>
            <button
              type="button"
              className="album-pick"
              disabled={busy}
              onClick={() => run(a.title, () => addToServerAlbum(a, photoId))}
            >
              <AlbumRow album={a} />
            </button>
          </li>
        ))}
        {albums !== null && shown.length === 0 && filter.trim() === "" && <li className="section-text">No other albums yet.</li>}
      </ul>
    </Modal>
  );
}
