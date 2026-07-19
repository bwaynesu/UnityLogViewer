; NSIS installer/uninstaller hooks for Unity Log Viewer.
; Tauri inserts all four macros, so each must be defined (empty is fine).

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove the installed-vs-portable marker before Tauri clears $INSTDIR, so the
  ; directory ends up empty and gets removed (bundle.resources isn't auto-deleted).
  Delete "$INSTDIR\installed.marker"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
