import type { Photo, UserAlbumInfo } from "@librephotos/api-client/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { hub } from "../db/database";
import type { FileEntry } from "../ipc";
import { errorText } from "../lib/infoCache";
import { serverRemoteOf, type RemoteOf } from "../library/api";
import { useServerStatus } from "../library/hooks";
import { fetchPhotoAlbums, fetchServerPhotoDetails } from "../library/serverApi";

export type ServerDetails =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; remote: RemoteOf; photo: Photo | null; albums: UserAlbumInfo[] | null };

const RECHECK_MS = 2500;

export function useServerDetails(file: FileEntry | null): [ServerDetails, () => void, (d: ServerDetails) => void] {
  const [status] = useServerStatus();
  const [state, setState] = useState<ServerDetails>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    let timer = 0;
    const stop = hub.watch(["upload_queue"], () => {
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

  const key = file ? `${file.path}|${file.modifiedMs}` : "";
  useEffect(() => {
    if (!status.connected || !file) return;
    let live = true;
    if (last.current !== key) setState({ status: "loading" });
    last.current = key;
    serverRemoteOf(file.path)
      .then(async remote => {
        if (remote.state !== "present" || !remote.photoId) {
          if (live) setState({ status: "ready", remote, photo: null, albums: null });
          return;
        }
        const id = remote.photoId;
        const [photo, albums] = await Promise.all([
          fetchServerPhotoDetails(id).catch(() => null),
          fetchPhotoAlbums(remote.imageHash ?? id).catch(() => null),
        ]);
        if (live) setState({ status: "ready", remote, photo, albums });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", error: errorText(err) });
      });
    return () => {
      live = false;
    };
  }, [key, file?.path, status.connected, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return [status.connected && file ? state : { status: "off" }, reload, setState];
}
