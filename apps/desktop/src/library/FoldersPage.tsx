import { IconFolder, IconFolderOpen, IconFolderPlus, IconFolders, IconPhoto, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { revealInFolder } from "../ipc";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Badge, Card, EmptyState, Progress } from "../ui/Display";
import { Menu } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { PageHeader } from "../ui/PageHeader";
import type { LibraryProgress, Root } from "./api";
import "./Pages.css";

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function FolderRow({
  root,
  indexing,
  onShow,
  onRemove,
  notify,
}: {
  root: Root;
  indexing: boolean;
  onShow(): void;
  onRemove(): void;
  notify(text: string, kind?: "error"): void;
}) {
  return (
    <div className="folder-row" data-testid="folder-row">
      <IconFolder className="folder-row-icon" size={20} stroke={1.5} aria-hidden="true" />
      <div className="folder-row-text">
        <div className="folder-row-title">
          <span className="folder-row-path">{root.path}</span>
          {indexing && (
            <Badge size="xs" tone="primary">
              Indexing
            </Badge>
          )}
        </div>
        <div className="folder-row-sub">
          {root.fileCount.toLocaleString()} {root.fileCount === 1 ? "picture or video" : "pictures and videos"}
        </div>
      </div>
      <Menu
        label={`Actions for ${folderName(root.path)}`}
        triggerClassName="small"
        groups={[
          [
            { icon: IconPhoto, label: "Show photos", onSelect: onShow },
            {
              icon: IconFolderOpen,
              label: "Show in Explorer",
              onSelect: () => revealInFolder(root.path).catch((err: unknown) => notify(`Couldn't show the folder: ${errorText(err)}`, "error")),
            },
          ],
          [{ icon: IconTrash, label: "Remove from library", onSelect: onRemove, danger: true }],
        ]}
      />
    </div>
  );
}

export function FoldersPage({
  roots,
  progress,
  onAdd,
  onShow,
  onRemove,
  notify,
}: {
  roots: Root[];
  progress: LibraryProgress | null;
  onAdd(): void;
  onShow(root: Root): void;
  onRemove(root: Root): void;
  notify(text: string, kind?: "error"): void;
}) {
  const [confirm, setConfirm] = useState<Root | null>(null);
  const indexing = progress !== null && (progress.walking || progress.pending > 0);
  const total = roots.reduce((n, r) => n + r.fileCount, 0);
  const read = progress ? Math.max(0, progress.files - progress.pending) : 0;
  return (
    <div className="page-scroll">
      <PageHeader
        narrow
        title="Folders"
        subtitle={`${roots.length.toLocaleString()} ${roots.length === 1 ? "folder" : "folders"} · ${total.toLocaleString()} pictures and videos`}
        actions={
          <Button variant="filled" leftIcon={IconFolderPlus} onClick={onAdd}>
            Add a folder
          </Button>
        }
      />
      <div className="page-body narrow stack-lg">
        {indexing && progress && (
          <Card testId="folders-progress">
            <div className="indexing">
              <div className="indexing-text" role="status">
                <span className="indexing-title">{progress.walking ? "Looking for pictures…" : "Reading pictures…"}</span>
                <span className="indexing-sub">
                  {progress.walking
                    ? `${progress.files.toLocaleString()} found so far`
                    : `${read.toLocaleString()} of ${progress.files.toLocaleString()} read`}
                </span>
              </div>
              <Progress
                value={progress.files > 0 ? (read / progress.files) * 100 : 0}
                size={6}
                striped={progress.walking}
                label="Indexing"
              />
            </div>
          </Card>
        )}
        <Card
          title="Library folders"
          description="The library shows the pictures and videos in these folders and keeps up with changes. Files stay where they are: nothing is copied or moved."
        >
          {roots.length === 0 ? (
            <EmptyState icon={IconFolders} title="No folders yet" description="Add the folders where your pictures are.">
              <Button variant="light" leftIcon={IconFolderPlus} onClick={onAdd}>
                Add a folder
              </Button>
            </EmptyState>
          ) : (
            <div className="folder-list">
              {roots.map(r => (
                <FolderRow
                  key={r.id}
                  root={r}
                  indexing={indexing}
                  onShow={() => onShow(r)}
                  onRemove={() => setConfirm(r)}
                  notify={notify}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
      {confirm && (
        <Modal
          title={`Remove ${folderName(confirm.path)} from the library?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  onRemove(confirm);
                  setConfirm(null);
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          Its {confirm.fileCount.toLocaleString()} pictures and videos leave the library and its search. The files stay in{" "}
          <span className="mono">{confirm.path}</span>.
        </Modal>
      )}
    </div>
  );
}
