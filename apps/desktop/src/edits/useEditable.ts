import type { LocalAssetEdits } from "@librephotos/local-db";
import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveStore } from "../db/live";
import type { FileEntry } from "../ipc";
import { errorText, useImageInfo } from "../lib/infoCache";
import {
  applyEdit,
  editableOf,
  favoriteEdit,
  favoriteMinRating,
  localEditsOf,
  savePhotoEdit,
  type Editable,
  type PhotoEdit,
  type SaveResult,
} from "./photoEdits";

type Local = { edits: LocalAssetEdits | null; favoriteMin: number };

const SETTLE_MS = 3000;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v.trim().toLowerCase() === b[i]?.trim().toLowerCase());

function reflects(value: Editable, edit: PhotoEdit): boolean {
  return (
    (edit.rating === undefined || edit.rating === value.rating) &&
    (edit.caption === undefined || edit.caption.trim() === value.caption.trim()) &&
    (edit.keywords === undefined || sameList(edit.keywords.filter(k => k.trim() !== ""), value.keywords)) &&
    (edit.takenAt === undefined || edit.takenAt === value.takenAt)
  );
}

const localStore = createLiveStore<Local | null>(null);

function useLocal(path: string | null): Local | null {
  const load = useCallback(async (): Promise<Local | null> => {
    if (!path) return null;
    const [edits, favoriteMin] = await Promise.all([localEditsOf(path), favoriteMinRating()]);
    return { edits, favoriteMin };
  }, [path]);
  return localStore.use(`edits:${path ?? ""}`, ["local_asset", "app_meta"], load)[0];
}

export type EditableState = {
  value: Editable | null;
  saving: boolean;
  save(edit: PhotoEdit): Promise<SaveResult | null>;
  toggleFavorite(): void;
  setRating(rating: number): void;
};

export type EditHandlers = {
  onSaved(file: FileEntry, result: SaveResult, edit: PhotoEdit): void;
  onError(file: FileEntry, message: string): void;
};

export function useEditable(file: FileEntry | null, handlers: EditHandlers): EditableState {
  const info = useImageInfo(file, 60);
  const local = useLocal(file?.path ?? null);
  const [pending, setPending] = useState<{ path: string; edit: PhotoEdit; settled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const base =
    file && info.status === "ready" && local
      ? editableOf(info.info, local.edits, local.favoriteMin)
      : null;
  const value = base && pending && file && pending.path === file.path ? applyEdit(base, pending.edit) : base;

  useEffect(() => {
    setPending(p => (p && p.path === file?.path ? p : null));
  }, [file?.path]);
  const fresh = info.status === "ready" && !info.stale;
  const caughtUp = base !== null && pending !== null && reflects(base, pending.edit);
  useEffect(() => {
    if (!pending?.settled || saving) return;
    if (fresh && caughtUp) {
      setPending(null);
      return;
    }
    const timer = window.setTimeout(() => setPending(p => (p === pending ? null : p)), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [fresh, caughtUp, pending, saving]);

  const save = useCallback(
    (edit: PhotoEdit): Promise<SaveResult | null> => {
      if (!file) return Promise.resolve(null);
      const target = file;
      setPending(p => ({
        path: target.path,
        edit: p && p.path === target.path ? { ...p.edit, ...edit } : edit,
        settled: false,
      }));
      setSaving(true);
      const run = chain.current.then(async () => {
        try {
          const result = await savePhotoEdit(target, edit);
          setPending(p => (p && p.path === target.path ? { ...p, settled: true } : p));
          handlersRef.current.onSaved(target, result, edit);
          return result;
        } catch (err) {
          setPending(p => (p && p.path === target.path ? null : p));
          handlersRef.current.onError(target, errorText(err));
          return null;
        } finally {
          setSaving(false);
        }
      });
      chain.current = run.catch(() => undefined);
      return run;
    },
    [file],
  );

  const valueRef = useRef(value);
  valueRef.current = value;
  const toggleFavorite = useCallback(() => {
    const v = valueRef.current;
    if (v) void save(favoriteEdit(v, !v.favorite));
  }, [save]);
  const setRating = useCallback(
    (rating: number) => {
      const v = valueRef.current;
      if (v) void save({ rating: v.rating === rating ? 0 : rating });
    },
    [save],
  );

  return { value, saving, save, toggleFavorite, setRating };
}
