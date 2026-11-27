import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { IconCode, IconLicense, IconShieldLock } from "@tabler/icons-react";
import { inTauri, openExternal } from "../ipc";
import { errorText } from "../lib/infoCache";
import { Button } from "../ui/Button";
import { Card } from "../ui/Display";
import { Modal } from "../ui/Modal";
import "./Pages.css";

export const NOTICES_URL = "/THIRD-PARTY-NOTICES.txt";
export const SOURCE_URL = "https://github.com/LibrePhotos/librephotos";
export const PRIVACY_URL = "https://docs.librephotos.com/docs/user-guide/desktop/privacy";

function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let live = true;
    getVersion().then(
      v => live && setVersion(v),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return version;
}

function NoticesModal({ onClose }: { onClose(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(NOTICES_URL)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        t => live && setText(t),
        (err: unknown) => live && setError(errorText(err)),
      );
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal
      title="Open-source licences"
      width={760}
      onClose={onClose}
      actions={
        <Button variant="filled" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error ? (
        <p className="section-text">Couldn't load the licences: {error}</p>
      ) : (
        <pre className="notices-text" data-testid="notices-text">
          {text ?? "Loading…"}
        </pre>
      )}
    </Modal>
  );
}

export function AboutCard() {
  const version = useAppVersion();
  const [showNotices, setShowNotices] = useState(false);
  return (
    <Card
      title="About LibrePhotos Viewer"
      description={`${version ? `Version ${version}. ` : ""}Free software under the MIT license, built on open-source components.`}
      testId="about-card"
    >
      <p className="section-text">
        This product includes DNG technology under license by Adobe. This software is based in part on the work of the
        Independent JPEG Group.
      </p>
      <div className="row-actions about-actions">
        <Button variant="light" size="compact" leftIcon={IconLicense} onClick={() => setShowNotices(true)} data-testid="open-notices">
          Open-source licences
        </Button>
        <Button variant="subtle" size="compact" leftIcon={IconCode} onClick={() => void openExternal(SOURCE_URL)}>
          Source code
        </Button>
        <Button variant="subtle" size="compact" leftIcon={IconShieldLock} onClick={() => void openExternal(PRIVACY_URL)}>
          Privacy policy
        </Button>
      </div>
      {showNotices && <NoticesModal onClose={() => setShowNotices(false)} />}
    </Card>
  );
}
