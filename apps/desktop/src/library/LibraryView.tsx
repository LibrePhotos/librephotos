import {
  IconAlertTriangle,
  IconCloud,
  IconFolder,
  IconFolderPlus,
  IconLayoutGrid,
  IconPhotoPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prewarmThumbs } from "../ipc";
import { errorText } from "../lib/infoCache";
import { addLibraryRoot, libraryByHashes, librarySearch, remoteThumbUrl, removeLibraryRoot, type LibraryFile, type Root } from "./api";
import { Grid } from "./Grid";
import { useLibraryFiles, useLibraryProgress, useRoots, useServerStatus } from "./hooks";
import { searchServer, type ServerHit } from "./serverApi";
import { ServerPanel, hostOf } from "./ServerPanel";
import "./Library.css";

const LOCAL_DEBOUNCE_MS = 120;
const SERVER_DEBOUNCE_MS = 350;
const PREWARM_DELAY_MS = 2500;

export type LibraryViewProps = {
  /** Open the viewer on `files[index]` with `files` as its navigation list. */
  onOpen(files: LibraryFile[], index: number): void;
  onOpenPicture(): void;
  /** Back to the picture that was open before, if any. */
  onBack: (() => void) | null;
  notify(text: string, kind?: "error"): void;
};

export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Add a folder to the library" });
  return typeof picked === "string" ? picked : null;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

type Search = {
  query: string;
  local: LibraryFile[] | null;
  /** Local files the server's search found (mapped back by MD5). */
  fromServer: LibraryFile[];
  serverOnly: ServerHit[];
  serverBusy: boolean;
  serverError: string | null;
  localMs: number | null;
};

const NO_SEARCH: Search = { query: "", local: null, fromServer: [], serverOnly: [], serverBusy: false, serverError: null, localMs: null };

function useSearch(query: string, connected: boolean): Search {
  const [s, setS] = useState<Search>(NO_SEARCH);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!q) {
      setS(NO_SEARCH);
      return;
    }
    const local = window.setTimeout(() => {
      const t0 = performance.now();
      librarySearch(q).then(
        files => {
          if (mine === seq.current) setS(prev => ({ ...prev, query: q, local: files, localMs: performance.now() - t0 }));
        },
        () => undefined,
      );
    }, LOCAL_DEBOUNCE_MS);
    let server = 0;
    if (connected) {
      setS(prev => ({ ...prev, serverBusy: true, serverError: null }));
      server = window.setTimeout(() => {
        searchServer(q)
          .then(async hits => {
            const matches = await libraryByHashes(hits.map(h => h.imageHash));
            if (mine !== seq.current) return;
            const mapped = new Set(matches.map(m => m.hash));
            setS(prev => ({
              ...prev,
              query: q,
              fromServer: matches.map(m => m.file).filter(f => f.rootId !== null),
              serverOnly: hits.filter(h => !mapped.has(h.imageHash)),
              serverBusy: false,
            }));
          })
          .catch((err: unknown) => {
            if (mine === seq.current) setS(prev => ({ ...prev, serverBusy: false, serverError: errorText(err), fromServer: [], serverOnly: [] }));
          });
      }, SERVER_DEBOUNCE_MS);
    } else {
      setS(prev => ({ ...prev, fromServer: [], serverOnly: [], serverBusy: false, serverError: null }));
    }
    return () => {
      window.clearTimeout(local);
      window.clearTimeout(server);
    };
  }, [query, connected]);
  return s;
}

function RootItem({ root, active, onSelect, onRemove }: { root: Root; active: boolean; onSelect(): void; onRemove(): void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`lib-nav-item root${active ? " active" : ""}`} title={root.path}>
      <button type="button" className="lib-nav-main" onClick={onSelect} aria-current={active ? "true" : undefined}>
        <IconFolder size={16} stroke={1.6} />
        <span className="lib-nav-label">{folderName(root.path)}</span>
        <span className="lib-nav-count">{root.fileCount.toLocaleString()}</span>
      </button>
      {confirm ? (
        <button type="button" className="btn small danger" onClick={onRemove} onBlur={() => setConfirm(false)} autoFocus>
          Remove
        </button>
      ) : (
        <button type="button" className="icon-btn lib-nav-remove" aria-label={`Remove ${folderName(root.path)} from the library`} onClick={() => setConfirm(true)}>
          <IconTrash size={14} stroke={1.6} />
        </button>
      )}
    </div>
  );
}

function RemotePreview({ hit, onClose }: { hit: ServerHit; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lib-preview" role="dialog" aria-label="Photo on LibrePhotos" onClick={onClose}>
      <img src={remoteThumbUrl(hit.imageHash, "big")} alt="" />
      <div className="lib-preview-note">Only on LibrePhotos</div>
      <button type="button" className="icon-btn lib-preview-close" aria-label="Close" onClick={onClose}>
        <IconX size={18} stroke={1.6} />
      </button>
    </div>
  );
}

export function LibraryView({ onOpen, onOpenPicture, onBack, notify }: LibraryViewProps) {
  const [rootId, setRootId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ServerHit | null>(null);
  const [roots, reloadRoots] = useRoots();
  const [files] = useLibraryFiles(rootId);
  const progress = useLibraryProgress();
  const [status, reloadStatus] = useServerStatus();
  const search = useSearch(query, status.connected);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (rootId !== null && roots.length > 0 && !roots.some(r => r.id === rootId)) setRootId(null);
  }, [roots, rootId]);

  const searching = query.trim() !== "";
  const shown = useMemo(() => {
    if (!searching) return files ?? [];
    const local = (search.local ?? []).filter(f => rootId === null || f.rootId === rootId);
    const merged = new Map(local.map(f => [f.path, f]));
    for (const f of search.fromServer) if (rootId === null || f.rootId === rootId) merged.set(f.path, f);
    return [...merged.values()].sort((a, b) => b.takenMs - a.takenMs || b.name.localeCompare(a.name));
  }, [searching, files, search.local, search.fromServer, rootId]);

  // Let Rust make the thumbs of this list into the disk cache while the app is idle.
  useEffect(() => {
    if (searching || shown.length < 2) return;
    const t = window.setTimeout(() => {
      prewarmThumbs(shown.map(f => f.path)).catch(() => undefined);
    }, PREWARM_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [shown, searching]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addFolder = useCallback(() => {
    pickFolder()
      .then(async path => {
        if (!path) return;
        const root = await addLibraryRoot(path);
        reloadRoots();
        notify(`Added ${folderName(root.path)} to the library`);
      })
      .catch((err: unknown) => notify(`Couldn't add the folder: ${errorText(err)}`, "error"));
  }, [notify, reloadRoots]);

  const removeRoot = useCallback(
    (root: Root) => {
      removeLibraryRoot(root.id).then(
        () => {
          reloadRoots();
          notify(`Removed ${folderName(root.path)} from the library. The files stay where they are.`);
        },
        (err: unknown) => notify(`Couldn't remove the folder: ${errorText(err)}`, "error"),
      );
    },
    [notify, reloadRoots],
  );

  const open = useCallback((index: number) => onOpen(shown, index), [onOpen, shown]);

  const title = rootId === null ? "All photos" : folderName(roots.find(r => r.id === rootId)?.path ?? "");
  const fromServerCount = searching ? search.fromServer.filter(f => !(search.local ?? []).some(l => l.path === f.path)).length : 0;
  const indexing = progress && (progress.walking || progress.pending > 0);

  return (
    <div className="library">
      <aside className="lib-side" aria-label="Library">
        <div className="lib-side-head">
          <span className="lib-app-name">Library</span>
          {onBack && (
            <button type="button" className="btn small" onClick={onBack}>
              Back to picture
            </button>
          )}
        </div>
        <nav className="lib-nav">
          <div className={`lib-nav-item${rootId === null ? " active" : ""}`}>
            <button type="button" className="lib-nav-main" onClick={() => setRootId(null)} aria-current={rootId === null ? "true" : undefined}>
              <IconLayoutGrid size={16} stroke={1.6} />
              <span className="lib-nav-label">All photos</span>
              <span className="lib-nav-count">{roots.reduce((n, r) => n + r.fileCount, 0).toLocaleString()}</span>
            </button>
          </div>
          <div className="lib-nav-section">
            <span>Folders</span>
            <button type="button" className="icon-btn" aria-label="Add a folder" data-tip="Add a folder" onClick={addFolder}>
              <IconFolderPlus size={16} stroke={1.6} />
            </button>
          </div>
          {roots.map(r => (
            <RootItem key={r.id} root={r} active={rootId === r.id} onSelect={() => setRootId(r.id)} onRemove={() => removeRoot(r)} />
          ))}
          {roots.length === 0 && <p className="lib-hint">No folders yet.</p>}
          <div className="lib-nav-section">
            <span>LibrePhotos</span>
          </div>
          <ServerPanel status={status} onChanged={reloadStatus} />
        </nav>
        {indexing && (
          <div className="lib-progress" role="status" data-testid="library-progress">
            {progress.walking ? "Looking for pictures…" : `Reading ${progress.pending.toLocaleString()} of ${progress.files.toLocaleString()} files…`}
          </div>
        )}
      </aside>
      <main className="lib-main">
        <header className="lib-head">
          <div className="lib-search">
            <IconSearch size={16} stroke={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={status.connected ? `Search this computer and ${hostOf(status.url)}` : "Search by name, folder, date, camera…"}
              aria-label="Search the library"
              data-testid="library-search"
            />
            {query && (
              <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}>
                <IconX size={14} stroke={1.75} />
              </button>
            )}
          </div>
          <div className="lib-head-title" data-testid="library-title">
            {searching ? (
              <>
                <span className="lib-strong">{shown.length.toLocaleString()}</span> found
                {fromServerCount > 0 && <span className="lib-sub"> · {fromServerCount} by LibrePhotos</span>}
                {search.serverOnly.length > 0 && <span className="lib-sub"> · {search.serverOnly.length} only on the server</span>}
                {search.serverBusy && <span className="lib-sub"> · asking {hostOf(status.url)}…</span>}
              </>
            ) : (
              <>
                <span className="lib-strong">{title}</span>
                <span className="lib-sub"> · {(files?.length ?? 0).toLocaleString()} items</span>
              </>
            )}
          </div>
        </header>
        {search.serverError && (
          <p className="lib-error banner" role="alert">
            <IconAlertTriangle size={14} stroke={1.75} /> LibrePhotos search failed: {search.serverError}
          </p>
        )}
        {searching && search.serverOnly.length > 0 && (
          <section className="lib-remote-strip" aria-label="Only on LibrePhotos">
            <div className="lib-strip-head">
              <IconCloud size={14} stroke={1.75} /> Only on LibrePhotos
            </div>
            <div className="lib-strip-items">
              {search.serverOnly.slice(0, 60).map(h => (
                <button key={h.imageHash} type="button" className="lib-strip-item" onClick={() => setPreview(h)} aria-label="Photo on LibrePhotos">
                  <img src={remoteThumbUrl(h.imageHash)} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        )}
        {roots.length === 0 && files !== null ? (
          <div className="lib-empty">
            <div className="lib-empty-card">
              <IconPhotoPlus size={34} stroke={1.3} />
              <h1>Your library is empty</h1>
              <p>Add the folders where your pictures are. They stay where they are; the library keeps up with changes.</p>
              <div className="lib-empty-actions">
                <button type="button" className="btn primary big" onClick={addFolder}>
                  Add a folder
                </button>
                <button type="button" className="btn big" onClick={onOpenPicture}>
                  Open a picture
                </button>
              </div>
            </div>
          </div>
        ) : searching && search.local !== null && shown.length === 0 && search.serverOnly.length === 0 && !search.serverBusy ? (
          <div className="lib-empty">
            <p className="lib-hint">Nothing matches “{query.trim()}”.</p>
          </div>
        ) : (
          <Grid files={shown} showRemote={status.connected} onOpen={open} scrollKey={`${rootId}|${search.query}`} />
        )}
      </main>
      {preview && <RemotePreview hit={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
