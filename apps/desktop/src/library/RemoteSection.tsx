import { IconCloud, IconCloudUpload, IconHeartFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FileEntry } from "../ipc";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Display";
import { DetailRow } from "../ui/Panel";
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

  // One detail row of the info panel (ui/Panel DetailRow): what the server knows, as the web
  // lightbox's sidebar shows it (title, dimmed lines, tags as light badges).
  let title;
  const sub: ReactNode[] = [];
  let extra: ReactNode = null;
  if (state.status === "loading") title = <span className="lp-remote-dim">Checking {host}…</span>;
  else if (state.status === "error") {
    title = `Couldn't ask ${host}`;
    sub.push(state.error);
  } else {
    const { remote, photo } = state;
    switch (remote.state) {
      case "present":
        title = (
          <span data-testid="remote-state">
            On {host}
            {photo?.favourite && <IconHeartFilled size={14} className="lp-remote-heart" aria-label="Favourite" />}
          </span>
        );
        if (photo?.caption) sub.push(<span className="lp-remote-caption">“{photo.caption}”</span>);
        if (photo && photo.people.length > 0) sub.push(`People: ${photo.people.join(", ")}`);
        if (photo?.place) sub.push(photo.place);
        if (photo && photo.tags.length > 0) {
          extra = (
            <div className="lp-remote-tags">
              {photo.tags.slice(0, 12).map(t => (
                <Badge key={t} tone="gray">
                  {t}
                </Badge>
              ))}
            </div>
          );
        }
        break;
      case "uploading":
      case "checking":
        title = <span data-testid="remote-state">Uploading to {host}…</span>;
        break;
      default:
        title = <span data-testid="remote-state">{remote.state === "failed" ? "Upload failed" : `Not on ${host} yet`}</span>;
        extra = (
          <div className="lp-remote-actions">
            <Button size="compact" variant="light" leftIcon={IconCloudUpload} onClick={upload}>
              Upload to LibrePhotos
            </Button>
          </div>
        );
    }
  }
  return (
    <DetailRow icon={IconCloud} title={title} sub={sub} label="LibrePhotos">
      {extra}
    </DetailRow>
  );
}
