import { getMeta, setMeta } from "@librephotos/local-db";
import { useCallback } from "react";
import { db } from "../db/database";
import { createLiveStore } from "../db/live";
import { inTauri } from "../ipc";

export type MetadataTarget = "sidecar" | "file" | "app";

export type AppSettings = {
  metadataTarget: MetadataTarget;
  onlineMaps: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = { metadataTarget: "sidecar", onlineMaps: false };

const KEYS = { metadataTarget: "desktop_metadata_target", onlineMaps: "desktop_online_maps" } as const;
const TARGETS: readonly MetadataTarget[] = ["sidecar", "file", "app"];

const isTarget = (v: string | null): v is MetadataTarget => v !== null && (TARGETS as readonly string[]).includes(v);

let browserSettings: AppSettings = DEFAULT_SETTINGS;

export async function loadSettings(): Promise<AppSettings> {
  if (!inTauri) return browserSettings;
  const [target, maps] = await Promise.all([getMeta(db, KEYS.metadataTarget), getMeta(db, KEYS.onlineMaps)]);
  return {
    metadataTarget: isTarget(target) ? target : DEFAULT_SETTINGS.metadataTarget,
    onlineMaps: maps === "1",
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  if (!inTauri) {
    browserSettings = { ...browserSettings, ...patch };
    store.clear();
    return;
  }
  if (patch.metadataTarget !== undefined) await setMeta(db, KEYS.metadataTarget, patch.metadataTarget);
  if (patch.onlineMaps !== undefined) await setMeta(db, KEYS.onlineMaps, patch.onlineMaps ? "1" : "0");
}

const store = createLiveStore<AppSettings>(DEFAULT_SETTINGS);

export function useAppSettings(): [AppSettings, (patch: Partial<AppSettings>) => Promise<void>] {
  const [settings, reload] = store.use("settings", ["app_meta"], loadSettings);
  const save = useCallback(
    async (patch: Partial<AppSettings>) => {
      await saveSettings(patch);
      reload();
    },
    [reload],
  );
  return [settings, save];
}

export const TARGET_LABEL: Record<MetadataTarget, string> = {
  sidecar: "Next to the photo (XMP sidecar)",
  file: "Into the photo file",
  app: "Only in this app",
};
