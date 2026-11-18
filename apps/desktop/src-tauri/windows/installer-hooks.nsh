; LibrePhotos Viewer: NSIS installer hooks (tauri.conf.json > bundle > windows > nsis > installerHooks).
;
; Tauri's template writes the ProgIDs (fileAssociations) but no "Capabilities", so Windows 11 lists
; the app under "Open with" without giving it a page in Settings > Apps > Default apps. Registering
; it under Software\RegisteredApplications as "${PRODUCTNAME}" adds that page, and the app's
; "Set as default photo viewer" opens it with ms-settings:defaultapps?registeredAppUser=<name>
; (see src/ops.rs; the name there must match PRODUCTNAME). SHCTX is HKCU or HKLM, as the install mode.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "Fast, private, local photo viewer"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".jpg" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".jpeg" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".jpe" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".jfif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".png" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".gif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".webp" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".bmp" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".tif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".tiff" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".heic" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".heif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".hif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".avif" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".jxl" "LibrePhotosViewer.Image"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".dng" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".cr2" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".cr3" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".nef" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".nrw" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".arw" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".orf" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".rw2" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".raf" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".pef" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".srw" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".raw" "LibrePhotosViewer.Raw"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "Software\${PRODUCTNAME}\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\${PRODUCTNAME}"
!macroend
