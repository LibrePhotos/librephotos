import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCloud,
  IconCloudCheck,
  IconCloudOff,
  IconCloudUpload,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolders,
  IconPhoto,
  IconPhotoPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prewarmThumbs, revealInFolder } from "../ipc";
import { errorText } from "../lib/infoCache";
import { Button, Loader } from "../ui/Button";
import { Alert, Avatar, EmptyState, Progress } from "../ui/Display";
import { IconButton } from "../ui/IconButton";
import { Logo } from "../ui/Logo";
import { NavLink } from "../ui/NavLink";
import { PageHeader } from "../ui/PageHeader";
import { SegmentedControl } from "../ui/Toggles";
import { addLibraryRoot, libraryByHashes, librarySearch, remoteThumbUrl, removeLibraryRoot, type LibraryFile, type Root } from "./api";
import { BackupCard } from "./BackupCard";
import { FoldersPage, folderName } from "./FoldersPage";
import { Grid } from "./Grid";
import { useLibraryDays, useLibraryFiles, useLibraryProgress, useRoots, useServerStatus } from "./hooks";
import { isWithin } from "./indexer";
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
              fromServer: matches.map(m => m.file).filter(f => f.inLibrary),
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

/** A server-only search hit, shown big over the page like the web lightbox (dark in both schemes). */
function RemotePreview({ hit, onClose }: { hit: ServerHit; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lib-preview lp-dark" role="dialog" aria-label="Photo on LibrePhotos" onClick={onClose}>
      <div className="lib-preview-bar" onClick={e => e.stopPropagation()}>
        <IconButton icon={IconX} label="Close" onClick={onClose} noTip />
        <div className="lib-preview-title">
          <IconCloud size={18} stroke={1.75} aria-hidden="true" /> Only on LibrePhotos
        </div>
      </div>
      <img src={remoteThumbUrl(hit.imageHash, "big")} alt="" />
    </div>
  );
}

type Page = "photos" | "folders" | "server";
type Scope = "all" | "local" | "remote";

const photos = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;

/**
 * The library window, drawn as the LibrePhotos web app: a header with the logo and the search
 * pill, the sidebar of pill rows on the chrome colour, and the page set into it with a rounded
 * corner (web components/menubars). Pages: the timeline (all photos or one folder), search results
 * (this computer and the server), folders, and the LibrePhotos connection.
 */
export function LibraryView({ onOpen, onOpenPicture, onBack, notify }: LibraryViewProps) {
  const [page, setPage] = useState<Page>("photos");
  const [rootId, setRootId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
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
  const rootPath = rootId === null ? null : (roots.find(r => r.id === rootId)?.path ?? null);
  const shown = useMemo(() => {
    if (!searching) return files ?? [];
    const inRoot = (f: LibraryFile) => rootPath === null || isWithin(f.path, rootPath);
    const merged = new Map((search.local ?? []).filter(inRoot).map(f => [f.path, f]));
    for (const f of search.fromServer) if (inRoot(f)) merged.set(f.path, f);
    return [...merged.values()].sort((a, b) => b.takenMs - a.takenMs || b.name.localeCompare(a.name));
  }, [searching, files, search.local, search.fromServer, rootPath]);

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

  useEffect(() => {
    if (!searching) setScope("all");
  }, [searching]);

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

  const go = (next: Page, root: string | null = null) => {
    setPage(next);
    setRootId(root);
    setQuery("");
  };

  const root = rootId === null ? null : (roots.find(r => r.id === rootId) ?? null);
  const fromServerCount = searching ? search.fromServer.filter(f => !(search.local ?? []).some(l => l.path === f.path)).length : 0;
  const indexing = progress !== null && (progress.walking || progress.pending > 0);
  const host = hostOf(status.url);
  const total = roots.reduce((n, r) => n + r.fileCount, 0);
  const days = useLibraryDays(rootId);

  // ------------------------------------------------------------ the current page

  let content;
  if (searching) {
    const localShown = scope === "remote" ? [] : shown;
    const remoteShown = scope === "local" ? [] : search.serverOnly;
    const parts = [`${shown.length.toLocaleString()} on this computer`];
    if (fromServerCount > 0) parts.push(`${fromServerCount.toLocaleString()} found by LibrePhotos`);
    if (search.serverOnly.length > 0) parts.push(`${search.serverOnly.length.toLocaleString()} only on LibrePhotos`);
    if (search.serverBusy) parts.push(`asking ${host}…`);
    const nothing = search.local !== null && shown.length === 0 && search.serverOnly.length === 0 && !search.serverBusy;
    content = (
      <>
        <PageHeader
          title={`“${query.trim()}”`}
          subtitle={search.local === null ? "Searching…" : parts.join(" · ")}
          loading={search.local === null || search.serverBusy}
          testId="library-title"
          actions={
            status.connected && (shown.length > 0 || search.serverOnly.length > 0) ? (
              <SegmentedControl<Scope>
                label="Where to show results from"
                value={scope}
                onChange={setScope}
                data={[
                  { value: "all", label: "All", count: shown.length + search.serverOnly.length },
                  { value: "local", label: "This computer", count: shown.length },
                  { value: "remote", label: "LibrePhotos", count: search.serverOnly.length },
                ]}
              />
            ) : undefined
          }
        />
        {search.serverError && (
          <div className="page-alert">
            <Alert tone="red" icon={IconAlertTriangle} title="LibrePhotos search failed">
              {search.serverError}
            </Alert>
          </div>
        )}
        {nothing ? (
          <EmptyState
            icon={IconSearch}
            title="No results"
            description={`Nothing on this computer${status.connected ? ` or on ${host}` : ""} matches “${query.trim()}”. Search looks at names, folders, dates, cameras and lenses${status.connected ? ", and LibrePhotos at people, things and captions" : ""}.`}
            testId="library-no-results"
          >
            <Button variant="subtle" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </EmptyState>
        ) : (
          <Grid
            files={localShown}
            showRemote={status.connected}
            onOpen={open}
            scrollKey={`${rootId}|${search.query}|${scope}`}
            remote={remoteShown}
            onOpenRemote={setPreview}
            sections={status.connected}
          />
        )}
      </>
    );
  } else if (page === "folders") {
    content = (
      <FoldersPage
        roots={roots}
        progress={progress}
        onAdd={addFolder}
        onShow={r => go("photos", r.id)}
        onRemove={removeRoot}
        notify={notify}
      />
    );
  } else if (page === "server") {
    content = <ServerPanel status={status} onChanged={reloadStatus} />;
  } else {
    const list = files ?? [];
    content = (
      <>
        <PageHeader
          title={root ? folderName(root.path) : "Photos"}
          subtitle={list.length === 0 ? undefined : `${photos(list.length)} · ${days.toLocaleString()} ${days === 1 ? "day" : "days"}`}
          loading={files === null}
          testId="library-title"
          actions={
            roots.length > 0 ? (
              root ? (
                <Button variant="neutral" leftIcon={IconFolderOpen} onClick={() => revealInFolder(root.path).catch((err: unknown) => notify(`Couldn't show the folder: ${errorText(err)}`, "error"))}>
                  Show in Explorer
                </Button>
              ) : (
                <Button variant="neutral" leftIcon={IconFolderPlus} onClick={addFolder}>
                  Add a folder
                </Button>
              )
            ) : undefined
          }
        />
        {roots.length === 0 && files !== null ? (
          <EmptyState
            icon={IconPhotoPlus}
            title="Your library is empty"
            description="Add the folders where your pictures are. They stay where they are, and the library keeps up with changes."
            testId="library-empty"
          >
            <Button variant="light" leftIcon={IconFolderPlus} onClick={addFolder}>
              Add a folder
            </Button>
            <Button variant="subtle" onClick={onOpenPicture}>
              Open a picture
            </Button>
          </EmptyState>
        ) : files !== null && list.length === 0 ? (
          <EmptyState
            icon={indexing ? IconPhoto : IconFolder}
            primary={indexing}
            title={indexing ? "Looking for pictures…" : "No pictures here"}
            description={
              indexing
                ? "The library is reading your folders. Pictures show up here as they are found."
                : "This folder has no pictures or videos the viewer can show."
            }
          />
        ) : files === null ? (
          <div className="page-loading">
            <Loader size={28} label="Loading the library" />
          </div>
        ) : (
          <Grid files={list} showRemote={status.connected} onOpen={open} scrollKey={`${rootId}`} />
        )}
      </>
    );
  }

  // ------------------------------------------------------------ the shell

  const c = status.counts;
  const backupPct = c.total > 0 ? (c.present / c.total) * 100 : 0;
  const BackupIcon = !status.connected ? IconCloudOff : status.uploads.length > 0 ? IconCloudUpload : IconCloudCheck;
  const onPhotos = !searching && page === "photos";

  return (
    <div className="library">
      <header className="lib-header">
        <div className="lib-brand">
          <Logo size={26} className="lib-logo" />
          <span className="lib-wordmark">LibrePhotos</span>
        </div>
        <div className="lib-header-main">
          <div className="lib-search">
            <IconSearch size={18} stroke={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={status.connected ? `Search this computer and ${host}` : "Search photos by name, folder, date, camera"}
              aria-label="Search the library"
              data-testid="library-search"
              spellCheck={false}
            />
            {query ? (
              <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
                <IconX size={16} stroke={1.75} />
              </button>
            ) : (
              <span className="lib-search-kbd" aria-hidden="true">
                <kbd className="kbd">Ctrl</kbd>
                <kbd className="kbd">F</kbd>
              </span>
            )}
          </div>
          <div className="lib-header-actions">
            {onBack && (
              <Button variant="neutral" leftIcon={IconArrowLeft} onClick={onBack}>
                Back to picture
              </Button>
            )}
            <IconButton icon={IconFolderOpen} label="Open a picture" onClick={onOpenPicture} />
            <IconButton
              icon={BackupIcon}
              label={status.connected ? `Backup to ${host}` : "Connect to LibrePhotos"}
              onClick={() => go("server")}
              pressed={page === "server" && !searching}
              tipEnd={!status.connected}
            />
            {status.connected && (
              <button
                type="button"
                className={`lib-avatar${page === "server" && !searching ? " current" : ""}`}
                aria-label={`Signed in to ${host} as ${status.username ?? ""}`}
                data-tip={`${status.username ?? ""} on ${host}`}
                data-tip-end=""
                onClick={() => go("server")}
              >
                <Avatar name={status.username ?? "?"} size={30} />
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="lib-navbar" aria-label="Library">
        <div className="lib-nav-links">
          <NavLink icon={IconPhoto} label="Photos" active={onPhotos && rootId === null} onClick={() => go("photos")} end={total > 0 ? total.toLocaleString() : undefined} />
          <NavLink icon={IconFolders} label="Folders" active={!searching && page === "folders"} onClick={() => go("folders")} />
          <NavLink icon={IconCloud} label="LibrePhotos" active={!searching && page === "server"} onClick={() => go("server")} />
          {roots.length > 0 && <div className="lib-nav-group">Folders</div>}
          {roots.map(r => (
            <NavLink
              key={r.id}
              icon={IconFolder}
              label={folderName(r.path)}
              title={r.path}
              active={onPhotos && rootId === r.id}
              end={r.fileCount.toLocaleString()}
              onClick={() => go("photos", r.id)}
            />
          ))}
          <NavLink icon={IconFolderPlus} label="Add a folder" dimmed onClick={addFolder} />
        </div>
        <div className="lib-nav-bottom">
          <button type="button" className="lib-storage" onClick={() => go("server")} data-testid="sidebar-backup">
            <span className="lib-storage-title">
              <IconCloud size={16} stroke={1.75} aria-hidden="true" /> Backup
            </span>
            {status.connected ? (
              <>
                <Progress value={backupPct} size={4} label={`Backed up to ${host}`} gray={!status.backup || status.paused} />
                <span className="lib-storage-text">
                  {c.total > 0 ? `${c.present.toLocaleString()} of ${c.total.toLocaleString()} on ${host}` : `Connected to ${host}`}
                </span>
              </>
            ) : (
              <span className="lib-storage-text">Not connected. Connect a LibrePhotos server to back up.</span>
            )}
          </button>
          {indexing && progress && (
            <div className="lib-footer-line" role="status" data-testid="library-progress">
              <Loader size={12} />
              {progress.walking
                ? `Looking for pictures… ${progress.files.toLocaleString()}`
                : `Reading ${progress.pending.toLocaleString()} of ${progress.files.toLocaleString()}`}
            </div>
          )}
        </div>
      </nav>

      <main className="lib-content">{content}</main>
      <BackupCard status={status} />
      {preview && <RemotePreview hit={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
