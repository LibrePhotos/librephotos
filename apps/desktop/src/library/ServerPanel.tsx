import { IconAlertTriangle, IconCloud, IconLogout, IconPlayerPause, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatBytes } from "../lib/format";
import { errorText } from "../lib/infoCache";
import { serverConnect, serverDisconnect, serverRetryFailed, serverSetBackup, serverSetPaused, type ServerStatus } from "./api";

export function hostOf(url: string | null): string {
  if (!url) return "your server";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ConnectForm({ status, onDone }: { status: ServerStatus; onDone(): void }) {
  const [url, setUrl] = useState(status.url ?? "");
  const [username, setUsername] = useState(status.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    serverConnect(url, username, password).then(
      () => {
        setPassword("");
        setBusy(false);
        onDone();
      },
      (err: unknown) => {
        setBusy(false);
        setError(errorText(err));
      },
    );
  };
  return (
    <form className="lib-connect" onSubmit={submit} aria-label="Connect to LibrePhotos">
      <p className="lib-hint">Connect your LibrePhotos server to back up this library and search by people, things and captions.</p>
      <label>
        <span>Server address</span>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="photos.example.com" autoComplete="url" required name="url" />
      </label>
      <label>
        <span>User name</span>
        <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required name="username" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required name="password" />
      </label>
      {(error ?? status.error) && (
        <p className="lib-error" role="alert">
          <IconAlertTriangle size={14} stroke={1.75} /> {error ?? status.error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

function Backup({ status }: { status: ServerStatus }) {
  const c = status.counts;
  const host = hostOf(status.url);
  const checked = c.total - c.unknown;
  const done = c.present;
  const pct = c.total > 0 ? Math.round((done / c.total) * 100) : 0;
  const busy = status.uploads.length > 0;
  return (
    <div className="lib-backup">
      <label className="lib-switch">
        <input type="checkbox" checked={status.backup} onChange={e => void serverSetBackup(e.target.checked)} />
        <span>Back up library to {host}</span>
      </label>
      {c.total > 0 && (
        <>
          <div className="lib-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Files on the server">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="lib-stat" data-testid="backup-counts">
            {done.toLocaleString()} of {c.total.toLocaleString()} on {host}
            {c.unknown > 0 && <span> · checking {c.unknown.toLocaleString()}</span>}
          </div>
          {checked > 0 && c.absent + c.failed + c.uploading > 0 && (
            <div className="lib-stat">
              {(c.absent + c.uploading).toLocaleString()} only here ({formatBytes(c.pendingBytes)})
              {!status.backup && " · turn on backup to upload them"}
            </div>
          )}
        </>
      )}
      {status.uploads.map(u => (
        <div key={u.name} className="lib-upload">
          <span className="lib-upload-name">{u.name}</span>
          <div className="lib-meter thin">
            <div style={{ width: `${u.total > 0 ? (u.sent / u.total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
      {(busy || status.uploadedFiles > 0) && (
        <div className="lib-stat">
          {status.uploadedFiles.toLocaleString()} uploaded ({formatBytes(status.uploadedBytes)})
          {busy && status.rate > 0 && <> · {formatBytes(status.rate)}/s</>}
        </div>
      )}
      <div className="lib-actions">
        {(status.backup || c.wanted > 0) && (
          <button type="button" className="btn small" onClick={() => void serverSetPaused(!status.paused)}>
            {status.paused ? <IconPlayerPlay size={14} stroke={1.75} /> : <IconPlayerPause size={14} stroke={1.75} />}
            {status.paused ? "Resume" : "Pause"}
          </button>
        )}
        {c.failed > 0 && (
          <button type="button" className="btn small" onClick={() => void serverRetryFailed()}>
            <IconRefresh size={14} stroke={1.75} /> Retry {c.failed.toLocaleString()} failed
          </button>
        )}
      </div>
    </div>
  );
}

/** The sidebar's server section: sign-in form, or connection, backup switch and progress. */
export function ServerPanel({ status, onChanged }: { status: ServerStatus; onChanged(): void }) {
  if (!status.connected) return <ConnectForm status={status} onDone={onChanged} />;
  return (
    <div className="lib-server">
      <div className="lib-server-head">
        <IconCloud size={16} stroke={1.75} />
        <div className="lib-server-who">
          <div className="lib-strong">{hostOf(status.url)}</div>
          <div className="lib-sub">Signed in as {status.username}</div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Disconnect"
          data-tip="Disconnect"
          data-tip-end=""
          onClick={() => void serverDisconnect().then(onChanged)}
        >
          <IconLogout size={16} stroke={1.6} />
        </button>
      </div>
      {status.error && (
        <p className="lib-error" role="alert">
          <IconAlertTriangle size={14} stroke={1.75} /> {status.error}
        </p>
      )}
      <Backup status={status} />
    </div>
  );
}
