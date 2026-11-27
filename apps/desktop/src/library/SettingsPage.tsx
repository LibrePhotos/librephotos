import { IconRefresh } from "@tabler/icons-react";
import { retryRejectedEdits, useEditSyncCounts } from "../edits/serverSync";
import { TARGET_LABEL, useAppSettings, type MetadataTarget } from "../edits/settings";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Card } from "../ui/Display";
import { PageHeader } from "../ui/PageHeader";
import { Switch } from "../ui/Toggles";
import { AboutCard } from "./AboutCard";
import "../chrome/edit/Edit.css";

const TARGET_HELP: Record<MetadataTarget, string> = {
  sidecar:
    "A small .xmp file next to the picture holds the rating, caption, keywords and date. The picture itself is never changed. LibrePhotos, digiKam and darktable read the same file, and a Lightroom sidecar that is already there is updated.",
  file: "Written into the picture itself, without re-compressing it. Only JPEG files can be changed this way; for other formats saving is refused. A sidecar the picture already has is updated too, since apps read it first. A changed file counts as a new file for backups.",
  app: "Kept only in this app's database. Files and other apps never see these changes.",
};

const TARGETS: MetadataTarget[] = ["sidecar", "file", "app"];

export function SettingsPage({ notify }: { notify(text: string, tone?: "error"): void }) {
  const [settings, save] = useAppSettings();
  const counts = useEditSyncCounts();
  const waiting = counts.pending + counts.inflight + counts.failed;
  const set = (patch: Parameters<typeof save>[0]) =>
    save(patch).catch((err: unknown) => notify(`Couldn't save the setting: ${errorText(err)}`, "error"));
  return (
    <div className="page-scroll">
      <PageHeader narrow title="Settings" testId="settings-title" />
      <div className="page-body narrow stack-lg">
        <Card
          title="Where edits are saved"
          description="Ratings, favourites, captions, keywords and dates you change in the viewer. Like the LibrePhotos server's Write edits to files setting."
        >
          <div className="target-list" role="radiogroup" aria-label="Where edits are saved">
            {TARGETS.map(t => (
              <label key={t} className={`target-option${settings.metadataTarget === t ? " checked" : ""}`}>
                <input
                  type="radio"
                  name="metadata-target"
                  value={t}
                  checked={settings.metadataTarget === t}
                  onChange={() => void set({ metadataTarget: t })}
                  data-testid={`target-${t}`}
                />
                <span className="target-text">
                  <span className="target-label">{TARGET_LABEL[t]}</span>
                  <span className="target-help">{TARGET_HELP[t]}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Maps" description="The info panel shows where a picture was taken.">
          <Switch
            checked={settings.onlineMaps}
            onChange={on => void set({ onlineMaps: on })}
            label="Show a map from OpenStreetMap"
            description="Loads map tiles from tile.openstreetmap.org, which then learns roughly where your pictures were taken. Off: the coordinates and an Open in map link only."
            testId="online-maps"
          />
        </Card>
        <Card
          title="Changes for the server"
          description="Edits of pictures that are also on your LibrePhotos server go there too. Without a connection they wait here and are sent when the server can be reached."
          actions={
            counts.rejected + counts.failed > 0 ? (
              <Button
                variant="light"
                size="compact"
                leftIcon={IconRefresh}
                onClick={() =>
                  void retryRejectedEdits().then(
                    n => notify(`Trying ${n} ${n === 1 ? "change" : "changes"} again`),
                    (err: unknown) => notify(errorText(err), "error"),
                  )
                }
              >
                Try again
              </Button>
            ) : undefined
          }
        >
          <p className="section-text" data-testid="edit-outbox">
            {waiting === 0 && counts.rejected === 0
              ? "Everything is sent."
              : [
                  waiting > 0 && `${waiting} ${waiting === 1 ? "change waits" : "changes wait"} for the server`,
                  counts.rejected > 0 && `${counts.rejected} refused by the server`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </Card>
        <AboutCard />
      </div>
    </div>
  );
}
