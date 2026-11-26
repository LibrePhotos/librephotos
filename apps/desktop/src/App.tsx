import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filmstrip } from "./chrome/Filmstrip";
import { InfoPanel } from "./chrome/InfoPanel";
import { ConfirmDelete, DropOverlay, EmptyState, FolderAccessHint, Toasts, useToasts } from "./chrome/Overlays";
import { TopBar, type TopBarActions } from "./chrome/TopBar";
import {
  clearThumbnailCache,
  copyImage,
  inTauri,
  initialPath,
  listFolder,
  onOpenRequest,
  openDefaultAppsSettings,
  prewarmThumbs,
  rememberFolder,
  revealInFolder,
  rotateFile,
  trashFile,
  type FileEntry,
} from "./ipc";
import { folderOf, formatBytes } from "./lib/format";
import { errorText } from "./lib/infoCache";
import { addLibraryRoot, serverUploadFile, type LibraryFile } from "./library/api";
import { useLibraryStatus, useServerStatus } from "./library/hooks";
import { LibraryView } from "./library/LibraryView";
import { contractErrorText, onContractError } from "./server/errors";
import { TRASH, focusWindow, onFileDrop, onFullscreenChange, pickFile, pickFolderAccess, setFullscreen, setWindowTitle } from "./platform";
import { Slideshow } from "./stage/Slideshow";
import { Stage, useNeighbours, type StageHandle } from "./stage/Stage";
import type { PhotoEdit, SaveResult } from "./edits/photoEdits";
import { useEditable } from "./edits/useEditable";
import "./chrome/edit/Edit.css";
import "./App.css";

type View = { folder: string; files: FileEntry[]; index: number; limited: boolean };

const IDLE_MS = 2500;
const PREWARM_DELAY_MS = 2000;
const APP_NAME = "LibrePhotos Viewer";

const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

export function nearestFirst(files: FileEntry[], index: number): string[] {
  const out: string[] = [];
  for (let d = 0; out.length < files.length && d <= files.length; d++) {
    const after = files[index + d];
    if (after) out.push(after.path);
    const before = d > 0 ? files[index - d] : undefined;
    if (before) out.push(before.path);
  }
  return out;
}

function withoutFile(view: View, path: string): View {
  const at = view.files.findIndex(f => f.path === path);
  if (at < 0) return view;
  const files = view.files.filter((_, i) => i !== at);
  const index = at < view.index ? view.index - 1 : Math.min(view.index, files.length - 1);
  return { ...view, files, index: Math.max(0, index) };
}

function useIdle(ms: number, keepAwake: () => boolean): { idle: boolean; hideNow(): void; wake(): void } {
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);
  const keep = useRef(keepAwake);
  keep.current = keepAwake;
  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(function tick() {
      if (keep.current()) timer.current = window.setTimeout(tick, ms);
      else setIdle(true);
    }, ms);
  }, [ms]);
  useEffect(() => {
    let lastX = -1;
    let lastY = -1;
    const wake = (e: Event) => {
      if (e instanceof MouseEvent && e.type === "mousemove") {
        if (e.clientX === lastX && e.clientY === lastY) return;
        lastX = e.clientX;
        lastY = e.clientY;
      }
      setIdle(false);
      arm();
    };
    arm();
    window.addEventListener("mousemove", wake, { passive: true });
    window.addEventListener("mousedown", wake, { passive: true });
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, [arm]);
  const hideNow = useCallback(() => {
    window.clearTimeout(timer.current);
    setIdle(true);
  }, []);
  const wake = useCallback(() => {
    setIdle(false);
    arm();
  }, [arm]);
  return { idle, hideNow, wake };
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [mode, setMode] = useState<"viewer" | "library">("viewer");
  const [starting, setStarting] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [fullscreen, setFs] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [confirmFile, setConfirmFile] = useState<FileEntry | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const askBeforeDelete = useRef(true);
  const stageRef = useRef<StageHandle | null>(null);
  const overChrome = useRef(false);
  const slideshowEnteredFullscreen = useRef(false);
  const rotateChain = useRef<Promise<void>>(Promise.resolve());
  const { toasts, push } = useToasts();
  useEffect(() => onContractError(error => push(contractErrorText(error), "error")), [push]);
  const { idle, hideNow: hideChromeNow, wake: showChrome } = useIdle(IDLE_MS, () => overChrome.current || confirmFile !== null);

  const files = useMemo(() => view?.files ?? [], [view]);
  const index = view?.index ?? 0;
  const current = files[index] ?? null;
  const neighbours = useNeighbours(files, index);
  const immersive = fullscreen || slideshow;
  const chromeHidden = immersive && idle && confirmFile === null;

  const openSeq = useRef(0);
  const hasView = useRef(false);
  hasView.current = view !== null && view.files.length > 0;
  const openPath = useCallback(
    async (path: string) => {
      const seq = ++openSeq.current;
      try {
        const listing = await listFolder(path);
        if (seq !== openSeq.current) return;
        if (listing.files.length === 0) throw new Error(`No pictures or videos in ${listing.folder}`);
        setView({ folder: listing.folder, files: listing.files, index: clampIndex(listing.index, listing.files.length), limited: listing.limited });
        setOpenError(null);
        setMode("viewer");
      } catch (err) {
        if (seq !== openSeq.current) return;
        const text = `Couldn't open ${path}: ${errorText(err)}`;
        if (hasView.current) push(text, "error");
        else setOpenError(text);
      } finally {
        if (seq === openSeq.current) setStarting(false);
      }
    },
    [push],
  );

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    onOpenRequest(path => {
      focusWindow();
      void openPath(path);
    })
      .then(fn => {
        if (!live) {
          fn();
          return null;
        }
        unlisten = fn;
        return initialPath();
      })
      .then(
        path => {
          if (!live) return;
          if (path) void openPath(path);
          else {
            setStarting(false);
            setMode("library");
          }
        },
        (err: unknown) => {
          if (!live) return;
          setOpenError(errorText(err));
          setStarting(false);
        },
      );
    return () => {
      live = false;
      unlisten?.();
    };
  }, [openPath]);

  useEffect(() => onFileDrop({ onHover: setDropHover, onDrop: path => void openPath(path) }), [openPath]);

  useEffect(() => onFullscreenChange(setFs), []);

  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    if (files.length < 2) return;
    const timer = window.setTimeout(() => {
      prewarmThumbs(nearestFirst(files, indexRef.current)).catch(() => undefined);
    }, PREWARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [files]);

  useEffect(() => {
    if (mode === "library") setWindowTitle(`Library - ${APP_NAME}`);
    else setWindowTitle(current ? `${current.name} - ${APP_NAME}` : APP_NAME);
  }, [current, mode]);

  const onSaved = useCallback(
    (file: FileEntry, result: SaveResult, edit: PhotoEdit) => {
      if (result.modifiedMs !== file.modifiedMs) {
        setView(v =>
          v ? { ...v, files: v.files.map(f => (f.path === file.path ? { ...f, modifiedMs: result.modifiedMs } : f)) } : v,
        );
      }
      if (edit.takenAt !== undefined) push(`Saved the date of ${file.name}`);
    },
    [push],
  );
  const onEditError = useCallback(
    (file: FileEntry, message: string) => push(`Couldn't save the change to ${file.name}: ${message}`, "error"),
    [push],
  );
  const editable = useEditable(mode === "viewer" ? current : null, { onSaved, onError: onEditError });
  const libStatus = useLibraryStatus(mode === "viewer" ? (current?.path ?? null) : null);
  const [server] = useServerStatus();
  const openFromLibrary = useCallback((list: LibraryFile[], at: number) => {
    if (list.length === 0) return;
    openSeq.current++;
    setView({ folder: "Library", files: list, index: clampIndex(at, list.length), limited: false });
    setOpenError(null);
    setMode("viewer");
  }, []);
  const addFolderToLibrary = useCallback(() => {
    if (!current) return;
    addLibraryRoot(folderOf(current.path)).then(
      root => push(`Added ${root.path} to the library`),
      (err: unknown) => push(`Couldn't add the folder: ${errorText(err)}`, "error"),
    );
  }, [current, push]);
  const uploadToServer = useCallback(() => {
    if (!current) return;
    const name = current.name;
    serverUploadFile(current.path).then(
      r => push(r.state === "present" ? `${name} is already on LibrePhotos` : `Uploading ${name} to LibrePhotos`),
      (err: unknown) => push(`Couldn't upload ${name}: ${errorText(err)}`, "error"),
    );
  }, [current, push]);

  const go = useCallback((target: number | ((i: number) => number)) => {
    setView(v => {
      if (!v || v.files.length === 0) return v;
      const next = clampIndex(typeof target === "function" ? target(v.index) : target, v.files.length);
      return next === v.index ? v : { ...v, index: next };
    });
  }, []);
  const prev = useCallback(() => go(i => i - 1), [go]);
  const next = useCallback(() => go(i => i + 1), [go]);

  const toggleFullscreen = useCallback(
    (on?: boolean) => {
      const target = on ?? !fullscreen;
      setFs(target);
      showChrome();
      setFullscreen(target).catch((err: unknown) => {
        if (!inTauri) return;
        setFs(!target);
        push(`Full screen isn't available: ${errorText(err)}`, "error");
      });
    },
    [fullscreen, push, showChrome],
  );

  const startSlideshow = useCallback(() => {
    if (!current) return;
    if (!fullscreen) {
      slideshowEnteredFullscreen.current = true;
      toggleFullscreen(true);
    }
    setSlideshow(true);
    hideChromeNow();
  }, [current, fullscreen, toggleFullscreen, hideChromeNow]);

  const stopSlideshow = useCallback(() => {
    setSlideshow(false);
    if (slideshowEnteredFullscreen.current) {
      slideshowEnteredFullscreen.current = false;
      toggleFullscreen(false);
    }
  }, [toggleFullscreen]);

  const performDelete = useCallback(
    async (file: FileEntry) => {
      try {
        await trashFile(file.path);
        setView(v => (v ? withoutFile(v, file.path) : v));
        push(`Moved ${file.name} to the ${TRASH}`);
      } catch (err) {
        push(`Couldn't delete ${file.name}: ${errorText(err)}`, "error");
      }
    },
    [push],
  );

  const requestDelete = useCallback(
    (skipConfirm: boolean) => {
      if (!current) return;
      if (skipConfirm || !askBeforeDelete.current) void performDelete(current);
      else setConfirmFile(current);
    },
    [current, performDelete],
  );

  const rotate = useCallback(
    (clockwise: boolean) => {
      const file = current;
      if (!file || file.kind === "video") return;
      stageRef.current?.rotateView(clockwise ? 1 : -1);
      rotateChain.current = rotateChain.current.then(async () => {
        try {
          const modifiedMs = await rotateFile(file.path, clockwise);
          setView(v =>
            v ? { ...v, files: v.files.map(f => (f.path === file.path ? { ...f, modifiedMs } : f)) } : v,
          );
        } catch (err) {
          push(`Rotated in view only. Couldn't rotate ${file.name}: ${errorText(err)}`, "error");
        }
      });
    },
    [current, push],
  );

  const copy = useCallback(() => {
    if (!current || current.kind === "video") return;
    const name = current.name;
    copyImage(current.path).then(
      () => push(`Copied ${name}`),
      (err: unknown) => push(`Couldn't copy ${name}: ${errorText(err)}`, "error"),
    );
  }, [current, push]);

  const reveal = useCallback(() => {
    if (!current) return;
    revealInFolder(current.path).catch((err: unknown) => push(`Couldn't show the folder: ${errorText(err)}`, "error"));
  }, [current, push]);

  const openDialog = useCallback(() => {
    pickFile().then(
      path => path && void openPath(path),
      (err: unknown) => push(`Couldn't open the file dialog: ${errorText(err)}`, "error"),
    );
  }, [openPath, push]);

  const showWholeFolder = useCallback(() => {
    if (!view || !current) return;
    const path = current.path;
    pickFolderAccess(view.folder)
      .then(async folder => {
        if (!folder) return;
        await rememberFolder(folder).catch(() => false);
        await openPath(path);
      })
      .catch((err: unknown) => push(`Couldn't open the folder dialog: ${errorText(err)}`, "error"));
  }, [view, current, openPath, push]);

  const setDefaultViewer = useCallback(() => {
    openDefaultAppsSettings().catch((err: unknown) => push(`Couldn't open the default apps settings: ${errorText(err)}`, "error"));
  }, [push]);

  const clearCache = useCallback(() => {
    clearThumbnailCache().then(
      bytes => push(`Cleared the thumbnail cache (${formatBytes(bytes)})`),
      (err: unknown) => push(`Couldn't clear the thumbnail cache: ${errorText(err)}`, "error"),
    );
  }, [push]);

  const actions: TopBarActions = {
    zoomIn: () => stageRef.current?.zoomIn(),
    zoomOut: () => stageRef.current?.zoomOut(),
    fit: () => stageRef.current?.home(),
    toggleActual: () => stageRef.current?.toggleActual(),
    rotate,
    remove: () => requestDelete(false),
    copy,
    reveal,
    toggleInfo: () => setInfoOpen(o => !o),
    slideshow: startSlideshow,
    toggleFullscreen: () => toggleFullscreen(),
    open: openDialog,
    setDefaultViewer,
    clearCache,
    library: () => setMode("library"),
    addFolderToLibrary: libStatus && !libStatus.root && current ? addFolderToLibrary : undefined,
    uploadToServer: server.connected && current && libStatus?.file?.remote !== "present" ? uploadToServer : undefined,
    toggleFavorite: editable.toggleFavorite,
  };

  const onKey = (e: KeyboardEvent) => {
    if (confirmFile || mode === "library") return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (slideshow) {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      stopSlideshow();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const handled = (() => {
      if (ctrl && /^[0-5]$/.test(key)) {
        if (!editable.value || current?.kind === "video") return true;
        const stars = Number(key);
        void editable.save({ rating: stars === editable.value.rating ? 0 : stars });
        return true;
      }
      switch (key) {
        case "ArrowLeft":
        case "PageUp":
          prev();
          return true;
        case "ArrowRight":
        case "PageDown":
          next();
          return true;
        case "Home":
          go(0);
          return true;
        case "End":
          go(files.length - 1);
          return true;
        case "+":
        case "=":
          stageRef.current?.zoomIn();
          return true;
        case "-":
        case "_":
          stageRef.current?.zoomOut();
          return true;
        case "0":
          stageRef.current?.home();
          return true;
        case "1":
          stageRef.current?.actualSize();
          return true;
        case "Delete":
          requestDelete(e.shiftKey);
          return true;
        case "F11":
          toggleFullscreen();
          return true;
        case "F5":
          startSlideshow();
          return true;
        case " ":
          if (e.target instanceof HTMLVideoElement) return false;
          startSlideshow();
          return true;
        case "Escape":
          if (fullscreen) toggleFullscreen(false);
          else stageRef.current?.home();
          return true;
      }
      switch (key.toLowerCase()) {
        case "r":
          rotate(!e.shiftKey);
          return true;
        case "c":
          if (!ctrl) return false;
          copy();
          return true;
        case "o":
          if (!ctrl) return false;
          openDialog();
          return true;
        case "f":
          if (ctrl) return false;
          if (current?.kind !== "video") editable.toggleFavorite();
          return true;
        case "i":
          if (ctrl) return false;
          setInfoOpen(o => !o);
          return true;
        case "l":
          if (ctrl) return false;
          setMode("library");
          return true;
      }
      return false;
    })();
    if (handled) e.preventDefault();
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const chromeEnter = () => {
    overChrome.current = true;
  };
  const chromeLeave = () => {
    overChrome.current = false;
  };

  const className = [
    "app",
    (current !== null || starting) && "viewing",
    infoOpen && current !== null && !slideshow && "info-open",
    immersive && "immersive",
    chromeHidden && "chrome-hidden",
    slideshow && "slideshow-on",
  ]
    .filter(Boolean)
    .join(" ");

  if (mode === "library") {
    return (
      <div className="app">
        <LibraryView
          onOpen={openFromLibrary}
          onOpenPicture={openDialog}
          onBack={files.length > 0 ? () => setMode("viewer") : null}
          notify={push}
        />
        <Toasts toasts={toasts} />
      </div>
    );
  }

  return (
    <div className={className}>
      <TopBar
        file={current}
        index={index}
        count={files.length}
        infoOpen={infoOpen}
        fullscreen={fullscreen}
        favorite={current && current.kind !== "video" && editable.value ? editable.value.favorite : null}
        actions={actions}
        onPointerEnter={chromeEnter}
        onPointerLeave={chromeLeave}
      />
      <div className="body">
        <main className="viewer">
          {current ? (
            slideshow ? (
              <Slideshow files={files} index={index} onAdvance={go} onStop={stopSlideshow} />
            ) : (
              <Stage
                file={current}
                neighbours={neighbours}
                handleRef={stageRef}
                hasPrev={index > 0}
                hasNext={index < files.length - 1}
                onPrev={prev}
                onNext={next}
                idle={idle}
              />
            )
          ) : starting ? (
            <div className="stage" />
          ) : (
            <EmptyState
              error={openError ?? (view ? `No more pictures in ${view.folder}` : null)}
              onOpen={openDialog}
              onSetDefault={setDefaultViewer}
            />
          )}
          {view?.limited && current && !slideshow && <FolderAccessHint folder={view.folder} onAllow={showWholeFolder} />}
          {files.length > 0 && (
            <Filmstrip
              files={files}
              index={index}
              onSelect={go}
              onPointerEnter={chromeEnter}
              onPointerLeave={chromeLeave}
            />
          )}
        </main>
        {infoOpen && current && !slideshow && (
          <InfoPanel file={current} onClose={() => setInfoOpen(false)} editable={editable} notify={push} />
        )}
      </div>
      <Toasts toasts={toasts} />
      {confirmFile && (
        <ConfirmDelete
          file={confirmFile}
          onCancel={() => setConfirmFile(null)}
          onConfirm={dontAsk => {
            if (dontAsk) askBeforeDelete.current = false;
            setConfirmFile(null);
            void performDelete(confirmFile);
          }}
        />
      )}
      {dropHover && <DropOverlay />}
    </div>
  );
}
