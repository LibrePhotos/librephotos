import type { Photo, PhotoEdit } from "@librephotos/api-client";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { escapeTargetsDialog } from "../../lightbox/escapeTarget";
import { useCompactViewer } from "../../lightbox/useCompactViewer";
import { ConfirmModal } from "../../modals/ConfirmModal";
import { AdvancedMode } from "../advanced/AdvancedMode";
import { EditorStage } from "../canvas/EditorStage";
import { usePreview } from "../canvas/usePreview";
import { EditorContext, type EditorApi } from "../EditorContext";
import type { EditSource } from "../engine/editSource";
import { DEFAULT_RECIPE, isIdentity } from "../engine/recipe";
import type { ViewMode } from "../engine/renderer";
import { SimpleMode } from "../simple/SimpleMode";
import { canRedo, canUndo, hasSavedEdit, isDirty } from "../state/session";
import { useEditSession } from "../state/useEditSession";
import { useEditorHotkeys } from "./editorHotkeys";
import { useEditorMode, type EditorMode } from "./editorMode";
import { EditorTopBar, ModeSwitch } from "./EditorTopBar";
import classes from "./EditorWorkspace.module.css";
import { PanelToggle } from "./PanelToggle";
import { UnsavedEditModal } from "./UnsavedEditModal";
import { useCopyPaste } from "./useCopyPaste";
import { useEditorLeaveGuard } from "./useEditorLeaveGuard";
import { useEditorPersistence } from "./useEditorPersistence";

type Props = Readonly<{
  photo: Photo;
  /** The photo's edit as the server sent it when the editor opened. */
  edit: PhotoEdit;
  source: EditSource;
  onClose: () => void;
}>;

/** What the canvas shows: the original while compare is held, else the split view or the edit. */
function viewMode(comparing: boolean, split: boolean): ViewMode {
  if (comparing) return "before";
  return split ? "split" : "after";
}

/** The file name shown in the bar: the last part of the photo's first path. */
function fileNameOf(photo: Photo): string {
  return photo.image_path[0]?.split(/[\\/]/).pop() ?? "";
}

/**
 * The editor once its edit and source are in: the session, the bar, the canvas and the panel of the
 * mode, the keys, and the questions before leaving or reverting.
 */
export function EditorWorkspace({ photo, edit, source, onClose }: Props) {
  const { t } = useTranslation();
  const compact = useCompactViewer();
  const [session, commands] = useEditSession(edit);
  const [mode, setMode] = useEditorMode();
  const [comparing, setComparing] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [cropActive, setCropShown] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const preview = usePreview(canvas, source);
  const dirty = isDirty(session);

  // Leaving the crop tool ends a crop drag in progress as its step.
  const setCropActive = useCallback(
    (active: boolean) => {
      if (!active && session.live?.action === "set" && session.live.control === "geometry.crop") {
        commands.apply("crop", session.recipe);
      }
      // The crop tool shows the full frame: the split view turns itself off.
      if (active) setSplitView(false);
      setCropShown(active);
    },
    [session, commands]
  );

  // Another mode shows other panels: the crop tool is put away first.
  const changeMode = (next: EditorMode) => {
    setCropActive(false);
    setMode(() => next);
  };

  const guard = useEditorLeaveGuard(dirty, onClose);
  const persistence = useEditorPersistence({ photoId: photo.id, session, onSaved: commands.saved, onDone: onClose });

  const copyPaste = useCopyPaste(session, commands);
  const toggleSplit = () => {
    if (!cropActive) setSplitView(on => !on);
  };
  useEditorHotkeys({
    undo: commands.undo,
    redo: commands.redo,
    copy: copyPaste.copy,
    paste: copyPaste.paste,
    toggleSplit,
    onCompare: setComparing,
    onEscape: event => {
      if (!escapeTargetsDialog(event.target, root.current?.closest('[role="dialog"]') ?? null)) return;
      if (cropActive) setCropActive(false);
      else guard.requestClose();
    },
  });

  const api = useMemo<EditorApi>(
    () => ({
      session,
      commands,
      source,
      sourceSize: { width: source.header.width, height: source.header.height },
      ready: preview.drawn !== null,
      cropActive,
      setCropActive,
      preview: preview.handle,
    }),
    [session, commands, source, preview.drawn, preview.handle, cropActive, setCropActive]
  );

  return (
    <EditorContext.Provider value={api}>
      <div
        ref={root}
        className={classes.shell}
        data-compact={compact || undefined}
        data-panel-collapsed={(compact && panelCollapsed) || undefined}
      >
        <EditorTopBar
          fileName={fileNameOf(photo)}
          mode={mode}
          onModeChange={changeMode}
          canUndo={canUndo(session)}
          canRedo={canRedo(session)}
          onUndo={commands.undo}
          onRedo={commands.redo}
          onCompare={setComparing}
          comparing={comparing}
          splitView={splitView && !cropActive}
          onToggleSplit={toggleSplit}
          splitReason={cropActive && t("editor.split.inCrop")}
          onCopy={copyPaste.copy}
          onPaste={copyPaste.paste}
          canReset={!isIdentity(session.recipe)}
          onReset={() => commands.apply("reset", DEFAULT_RECIPE)}
          canRevert={hasSavedEdit(edit)}
          onRevert={persistence.askRevert}
          dirty={dirty}
          saving={persistence.saving}
          onSave={() => {
            if (dirty) persistence.save();
          }}
          onClose={guard.requestClose}
          compact={compact}
        />
        <div className={classes.main}>
          <EditorStage
            preview={preview}
            canvasRef={setCanvas}
            recipe={session.recipe}
            mode={viewMode(comparing, splitView && !cropActive)}
            split={split}
            onSplitChange={setSplit}
            cropActive={cropActive}
          />
          <aside className={classes.panel} aria-label={t("editor.panel")}>
            {compact && (
              <div className={classes.panelHeader}>
                <ModeSwitch mode={mode} onModeChange={changeMode} />
                <PanelToggle collapsed={panelCollapsed} onToggle={() => setPanelCollapsed(value => !value)} />
              </div>
            )}
            <div className={classes.panelBody}>{mode === "simple" ? <SimpleMode /> : <AdvancedMode />}</div>
          </aside>
        </div>
      </div>
      <UnsavedEditModal
        opened={guard.question !== null}
        onClose={guard.stay}
        onDiscard={guard.leave}
        onSave={() => persistence.save(guard.leave)}
        saving={persistence.saving}
      />
      <ConfirmModal
        opened={persistence.revertAsked}
        onClose={persistence.cancelRevert}
        onConfirm={persistence.revert}
        title={t("editor.revertDialog.title")}
        message={t("editor.revertDialog.message")}
        confirmLabel={t("editor.revertDialog.confirm")}
        loading={persistence.reverting}
      />
    </EditorContext.Provider>
  );
}
