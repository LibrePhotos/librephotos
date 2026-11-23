import { IconCloud, IconCloudUpload, IconHeartFilled } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { FileEntry } from "../ipc";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Display";
import { DetailRow } from "../ui/Panel";
import type { ServerDetails } from "../edits/serverDetails";
import { serverUploadFile } from "./api";
import { useServerStatus } from "./hooks";
import { hostOf } from "./ServerPanel";
import { serverPhotoOf } from "./serverApi";
import "./Library.css";

export function RemoteSection({
  file,
  details,
  setDetails,
}: {
  file: FileEntry;
  details: ServerDetails;
  setDetails(d: ServerDetails): void;
}) {
  const [status] = useServerStatus();
  const state = details;
  if (!status.connected || state.status === "off") return null;
  const host = hostOf(status.url);
  const upload = () => {
    serverUploadFile(file.path).then(
      remote =>
        setDetails({
          status: "ready",
          remote: { ...remote, state: remote.state === "present" ? "present" : "uploading" },
          photo: null,
          albums: null,
        }),
      (err: unknown) => setDetails({ status: "error", error: errorText(err) }),
    );
  };

  let title;
  const sub: ReactNode[] = [];
  let extra: ReactNode = null;
  if (state.status === "loading") title = <span className="lp-remote-dim">Checking {host}…</span>;
  else if (state.status === "error") {
    title = `Couldn't ask ${host}`;
    sub.push(state.error);
  } else {
    const { remote } = state;
    const photo = state.photo ? serverPhotoOf(state.photo) : null;
    switch (remote.state) {
      case "present":
        title = (
          <span data-testid="remote-state">
            On {host}
            {photo?.favourite && <IconHeartFilled size={14} className="lp-remote-heart" aria-label="Favourite" />}
          </span>
        );
        if (photo?.place) sub.push(photo.place);
        if (photo && photo.tags.length > 0) {
          extra = (
            <div className="lp-remote-tags" aria-label="Things the server found">
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
