import { IconCloud, IconHeartFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../ipc";
import { errorText } from "../lib/infoCache";
import { onLibraryChanged, serverRemoteOf, serverUploadFile, type RemoteOf } from "./api";
import { useServerStatus } from "./hooks";
import { hostOf } from "./ServerPanel";
import { fetchServerPhoto, type ServerPhoto } from "./serverApi";
import "./Library.css";

type State =
  | { status: "loading" }
  | { status: "ready"; remote: RemoteOf; photo: ServerPhoto | null }
  | { status: "error"; error: string };

/** Re-asks after library changes (an upload finished), at most every few seconds. */
const RECHECK_MS = 2500;

/**
 * The info panel's "LibrePhotos" row: whether the server has this file (by MD5) and, when it
 * does, what it knows: caption, people, tags, favourite. Only while connected.
 */
export function RemoteSection({ file }: { file: FileEntry }) {
  const [status] = useServerStatus();
  const [state, setState] = useState<State>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    let timer = 0;
    const stop = onLibraryChanged(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        setTick(t => t + 1);
      }, RECHECK_MS);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  const key = `${file.path}|${file.modifiedMs}`;
  useEffect(() => {
    if (!status.connected) return;
    let live = true;
    if (last.current !== key) setState({ status: "loading" });
    last.current = key;
    serverRemoteOf(file.path)
      .then(async remote => {
        const photo = remote.state === "present" && remote.photoId ? await fetchServerPhoto(remote.photoId).catch(() => null) : null;
        if (live) setState({ status: "ready", remote, photo });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", error: errorText(err) });
      });
    return () => {
      live = false;
    };
  }, [key, file.path, status.connected, tick]);

  if (!status.connected) return null;
  const host = hostOf(status.url);
  const upload = () => {
    serverUploadFile(file.path).then(
      remote => setState({ status: "ready", remote: { ...remote, state: remote.state === "present" ? "present" : "uploading" }, photo: null }),
      (err: unknown) => setState({ status: "error", error: errorText(err) }),
    );
  };

  let body;
  if (state.status === "loading") body = <div className="info-sub">Checking {host}…</div>;
  else if (state.status === "error") body = <div className="info-sub">Couldn't ask {host}: {state.error}</div>;
  else {
    const { remote, photo } = state;
    switch (remote.state) {
      case "present":
        body = (
          <>
            <div className="info-strong" data-testid="remote-state">
              On {host}
              {photo?.favourite && <IconHeartFilled size={14} style={{ marginLeft: 6, verticalAlign: -2 }} aria-label="Favourite" />}
            </div>
            {photo?.caption && <div className="lp-remote-caption">“{photo.caption}”</div>}
            {photo && photo.people.length > 0 && <div>People: {photo.people.join(", ")}</div>}
            {photo?.place && <div className="info-sub">{photo.place}</div>}
            {photo && photo.tags.length > 0 && (
              <div className="chips">
                {photo.tags.slice(0, 12).map(t => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        );
        break;
      case "uploading":
      case "checking":
        body = <div className="info-strong" data-testid="remote-state">Uploading to {host}…</div>;
        break;
      default:
        body = (
          <>
            <div className="info-strong" data-testid="remote-state">
              {remote.state === "failed" ? "Upload failed" : `Not on ${host} yet`}
            </div>
            <button type="button" className="btn small" onClick={upload}>
              Upload to LibrePhotos
            </button>
          </>
        );
    }
  }
  return (
    <div className="info-row">
      <IconCloud className="info-icon" size={18} stroke={1.5} aria-hidden="true" />
      <div className="info-body">
        <div className="info-label">LibrePhotos</div>
        <div className="info-value lp-remote">{body}</div>
      </div>
    </div>
  );
}
