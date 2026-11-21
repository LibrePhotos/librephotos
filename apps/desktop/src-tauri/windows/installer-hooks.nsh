!define LPV_CAPABILITIES "Software\${PRODUCTNAME}\Capabilities"
!define LPV_APPLICATION "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!define LPV_APP_PATH "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAINBINARYNAME}.exe"
!define LPV_DEFAULT_APPS "ms-settings:defaultapps?registeredApp"
!searchreplace LPV_URL_NAME "${PRODUCTNAME}" " " "%20"

Var LpvDefaultAppsPage
!define MUI_FINISHPAGE_LINK "Choose ${PRODUCTNAME} as your photo viewer"
!define MUI_FINISHPAGE_LINK_LOCATION "$LpvDefaultAppsPage"

!macro LPV_EACH_TYPE MACRO
  !insertmacro ${MACRO} ".jpg" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".jpeg" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".jpe" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".jfif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".png" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".gif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".webp" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".bmp" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".tif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".tiff" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".heic" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".heif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".hif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".avif" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".jxl" "LibrePhotosViewer.Image"
  !insertmacro ${MACRO} ".dng" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".cr2" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".cr3" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".nef" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".nrw" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".arw" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".orf" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".rw2" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".raf" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".pef" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".srw" "LibrePhotosViewer.Raw"
  !insertmacro ${MACRO} ".raw" "LibrePhotosViewer.Raw"
!macroend

!macro LPV_OFFER_TYPE EXT PROGID
  ReadRegStr $R0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $R0 == "${PROGID}"
    ReadRegStr $R1 SHCTX "Software\Classes\${EXT}" "${PROGID}_backup"
    ${If} $R1 == ""
      DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
    ${Else}
      WriteRegStr SHCTX "Software\Classes\${EXT}" "" "$R1"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "${PROGID}_backup"
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr SHCTX "${LPV_APPLICATION}\SupportedTypes" "${EXT}" ""
  WriteRegStr SHCTX "${LPV_CAPABILITIES}\FileAssociations" "${EXT}" "${PROGID}"
!macroend

!macro LPV_KEEP_DEFAULT_ON_UNINSTALL EXT PROGID
  ReadRegStr $R0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $R0 == "${PROGID}"
    StrCpy $R0 ""
  ${EndIf}
  WriteRegStr SHCTX "Software\Classes\${EXT}" "${PROGID}_backup" "$R0"
!macroend

!macro LPV_WITHDRAW_TYPE EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "${PROGID}_backup"
  ReadRegStr $R0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${LPV_CAPABILITIES}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${LPV_CAPABILITIES}" "ApplicationDescription" "Fast, private, local photo viewer"
  WriteRegStr SHCTX "${LPV_CAPABILITIES}" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${LPV_APPLICATION}" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${LPV_APPLICATION}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "${LPV_APPLICATION}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "${LPV_APP_PATH}" "" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro LPV_EACH_TYPE LPV_OFFER_TYPE
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "${LPV_CAPABILITIES}"
  ${If} $MultiUser.InstallMode == "AllUsers"
    StrCpy $LpvDefaultAppsPage "${LPV_DEFAULT_APPS}Machine=${LPV_URL_NAME}"
  ${Else}
    StrCpy $LpvDefaultAppsPage "${LPV_DEFAULT_APPS}User=${LPV_URL_NAME}"
  ${EndIf}
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LPV_EACH_TYPE LPV_KEEP_DEFAULT_ON_UNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "${LPV_CAPABILITIES}"
  DeleteRegKey /ifempty SHCTX "Software\${PRODUCTNAME}"
  DeleteRegKey SHCTX "${LPV_APPLICATION}"
  DeleteRegKey SHCTX "${LPV_APP_PATH}"
  !insertmacro LPV_EACH_TYPE LPV_WITHDRAW_TYPE
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
