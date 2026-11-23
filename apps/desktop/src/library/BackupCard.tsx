import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronUp, IconPhoto, IconRotateClockwise, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { formatBytes } from "../lib/format";
import { Button, Loader } from "../ui/Button";
import { Progress } from "../ui/Display";
import { IconButton } from "../ui/IconButton";
import { serverRetryFailed, serverSetPaused, type ServerStatus } from "./api";
import { hostOf } from "./ServerPanel";
import "./Pages.css";

function heading(status: ServerStatus): { title: string; detail: string | null; done: boolean } {
  const c = status.counts;
  const host = hostOf(status.url);
  const left = c.absent + c.uploading;
  if (status.paused) return { title: "Backup paused", detail: `${left.toLocaleString()} left to upload to ${host}`, done: false };
  if (status.uploads.length > 0 || left > 0) {
    const rate = status.rate > 0 ? ` · ${formatBytes(status.rate)}/s` : "";
    return {
      title: `Backing up to ${host}`,
      detail: `${left.toLocaleString()} left · ${formatBytes(c.pendingBytes)}${rate}`,
      done: false,
    };
  }
  if (c.unknown > 0) return { title: `Checking ${c.unknown.toLocaleString()} files`, detail: `Asking ${host} which it has`, done: false };
  return {
    title: c.failed > 0 ? `Backed up, ${c.failed.toLocaleString()} failed` : "Backed up",
    detail: `${status.uploadedFiles.toLocaleString()} uploaded (${formatBytes(status.uploadedBytes)}) · ${c.present.toLocaleString()} of ${c.total.toLocaleString()} on ${host}`,
    done: true,
  };
}

export function BackupCard({ status }: { status: ServerStatus }) {
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState(false);
  const c = status.counts;
  const active = status.connected && (status.uploads.length > 0 || (status.backup && c.absent + c.uploading > 0));
  useEffect(() => {
    if (active) setClosed(false);
  }, [active]);
  const showDone = status.connected && status.backup && status.uploadedFiles > 0;
  if (!active && !showDone) return null;
  if (closed) return null;
  const { title, detail, done } = heading(status);
  const pct = c.total > 0 ? (c.present / c.total) * 100 : 0;
  const inFlight = status.uploads.reduce((n, u) => n + (u.total > 0 ? u.sent / u.total : 0), 0);
  return (
    <section className="upload-card" aria-label="Backup" data-testid="upload-progress-card">
      <div className="upload-card-head">
        <div className="upload-card-text">
          <div className="upload-card-title" aria-live="polite">
            {title}
          </div>
          {detail && <div className="upload-card-detail">{detail}</div>}
        </div>
        <div className="upload-card-buttons">
          <IconButton
            icon={collapsed ? IconChevronUp : IconChevronDown}
            label={collapsed ? "Expand" : "Collapse"}
            size="sm"
            noTip
            onClick={() => setCollapsed(v => !v)}
          />
          {done ? (
            <IconButton icon={IconX} label="Close" size="sm" noTip onClick={() => setClosed(true)} />
          ) : (
            <Button size="compact" variant="neutral" onClick={() => void serverSetPaused(!status.paused)}>
              {status.paused ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </div>
      <div className="upload-card-bar">
        <Progress
          value={pct}
          muted={c.total > 0 ? (inFlight / c.total) * 100 : 0}
          size={4}
          label="Backed up"
          gray={status.paused}
        />
      </div>
      {!collapsed && status.uploads.length > 0 && (
        <div className="upload-rows">
          {status.uploads.map(u => {
            const p = u.total > 0 ? Math.round((u.sent / u.total) * 100) : 0;
            return (
              <div key={u.name} className="upload-row" data-testid="upload-row">
                <span className="upload-thumb" aria-hidden="true">
                  <IconPhoto size={16} stroke={1.75} />
                </span>
                <div className="upload-row-text">
                  <span className="upload-row-name" title={u.name}>
                    {u.name}
                  </span>
                  <span className="upload-row-status">
                    Uploading {p} % · {formatBytes(u.total)}
                  </span>
                </div>
                {status.paused ? null : <Loader size={14} />}
                <Progress value={p} size={2} label={`${u.name} uploaded`} className="upload-row-progress" />
              </div>
            );
          })}
        </div>
      )}
      {!collapsed && done && (
        <div className="upload-rows">
          {c.failed > 0 && (
            <div className="upload-row">
              <span className="upload-thumb failed" aria-hidden="true">
                <IconAlertTriangle size={16} stroke={1.75} />
              </span>
              <div className="upload-row-text">
                <span className="upload-row-name">
                  {c.failed.toLocaleString()} {c.failed === 1 ? "file" : "files"} couldn't be uploaded
                </span>
                <span className="upload-row-status failed">Upload failed</span>
              </div>
              <Button size="compact" variant="subtle" leftIcon={IconRotateClockwise} onClick={() => void serverRetryFailed()}>
                Retry
              </Button>
            </div>
          )}
          <div className="upload-row">
            <span className="upload-thumb done" aria-hidden="true">
              <IconCheck size={16} stroke={2} />
            </span>
            <div className="upload-row-text">
              <span className="upload-row-name">
                {c.failed > 0 ? "Everything else is" : "Your library is"} on {hostOf(status.url)}
              </span>
              <span className="upload-row-status">New pictures in your folders are backed up as they arrive.</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
