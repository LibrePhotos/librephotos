import { IconAlertTriangle, IconLogout, IconPlayerPause, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatBytes } from "../lib/format";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Alert, Avatar, Card, Progress } from "../ui/Display";
import { PasswordInput, TextInput } from "../ui/Inputs";
import { Logo } from "../ui/Logo";
import { PageHeader } from "../ui/PageHeader";
import { Switch } from "../ui/Toggles";
import { serverConnect, serverDisconnect, serverRetryFailed, serverSetBackup, serverSetPaused, type ServerStatus } from "./api";
import "./Pages.css";

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
  const problem = error ?? status.error;
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Logo size={36} className="auth-logo" />
        <span>LibrePhotos</span>
      </div>
      <form className="auth-card lib-connect" onSubmit={submit} aria-label="Connect to LibrePhotos">
        <div className="auth-head">
          <h2 className="auth-title">Connect to your server</h2>
          <p className="auth-description">Back up this library and search it by people, things and captions.</p>
        </div>
        {problem && (
          <Alert tone="red" icon={IconAlertTriangle} title="Couldn't connect">
            {problem}
          </Alert>
        )}
        <TextInput
          label="Server address"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="photos.example.com"
          autoComplete="url"
          required
          name="url"
          spellCheck={false}
        />
        <TextInput
          label="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          required
          name="username"
          spellCheck={false}
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          name="password"
        />
        <Button type="submit" variant="filled" size="lg" fullWidth loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="auth-tagline">Your password is sent to your server only.</p>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString()}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

function Backup({ status }: { status: ServerStatus }) {
  const c = status.counts;
  const host = hostOf(status.url);
  const pct = c.total > 0 ? (c.present / c.total) * 100 : 0;
  const onlyHere = c.absent + c.uploading + c.failed;
  return (
    <Card
      title="Backup"
      description={`Uploads the pictures and videos of your library folders that ${host} doesn't have yet. Nothing on this computer is changed.`}
      testId="backup-card"
    >
      <div className="stack">
        <Switch
          checked={status.backup}
          onChange={on => void serverSetBackup(on)}
          label={`Back up this library to ${host}`}
          description={status.paused ? "Paused: checks go on, uploads wait." : undefined}
          testId="backup-switch"
        />
        {c.total > 0 && (
          <>
            <div className="stats">
              <Stat label={`On ${host}`} value={c.present} />
              <Stat label="Only on this computer" value={onlyHere} detail={onlyHere > 0 ? formatBytes(c.pendingBytes) : undefined} />
              <Stat label="Checking" value={c.unknown} />
            </div>
            <div className="backup-meter">
              <Progress value={pct} size={6} label={`Files on ${host}`} gray={status.paused} />
              <div className="backup-meter-text" data-testid="backup-counts">
                {c.present.toLocaleString()} of {c.total.toLocaleString()} on {host}
                {c.unknown > 0 && <span> · checking {c.unknown.toLocaleString()}</span>}
                {!status.backup && onlyHere > 0 && <span> · turn on backup to upload the rest</span>}
              </div>
            </div>
          </>
        )}
        {(status.backup || c.wanted > 0 || c.failed > 0) && (
          <div className="row-actions">
            {(status.backup || c.wanted > 0) && (
              <Button
                size="xs"
                leftIcon={status.paused ? IconPlayerPlay : IconPlayerPause}
                onClick={() => void serverSetPaused(!status.paused)}
              >
                {status.paused ? "Resume uploads" : "Pause uploads"}
              </Button>
            )}
            {c.failed > 0 && (
              <Button size="xs" leftIcon={IconRefresh} onClick={() => void serverRetryFailed()}>
                Retry {c.failed.toLocaleString()} failed
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function ServerPanel({ status, onChanged }: { status: ServerStatus; onChanged(): void }) {
  if (!status.connected) return <ConnectForm status={status} onDone={onChanged} />;
  const host = hostOf(status.url);
  return (
    <div className="page-scroll">
      <PageHeader narrow title="LibrePhotos" subtitle={`Connected to ${host}`} />
      <div className="page-body narrow stack-lg">
        {status.error && (
          <Alert tone="red" icon={IconAlertTriangle}>
            {status.error}
          </Alert>
        )}
        <Card title="Account">
          <div className="account-row">
            <Avatar name={status.username ?? "?"} size={40} />
            <div className="account-who">
              <div className="account-host">{host}</div>
              <div className="account-sub">Signed in as {status.username}</div>
            </div>
            <Button leftIcon={IconLogout} onClick={() => void serverDisconnect().then(onChanged)}>
              Sign out
            </Button>
          </div>
        </Card>
        <Backup status={status} />
      </div>
    </div>
  );
}
