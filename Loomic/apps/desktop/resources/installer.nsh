!macro customHeader
  SetFont "Microsoft YaHei UI" 9
!macroend

LangString HelsteraWelcomeTitle 2052 "欢迎安装 Helstera"
LangString HelsteraWelcomeTitle 1033 "Welcome to Helstera"
LangString HelsteraWelcomeText 2052 "在桌面上使用创作工作区、录屏与视频导出。$\r$\n$\r$\n建议仅为当前用户安装，无需管理员权限。下一步可选择安装目录。$\r$\n$\r$\n升级会保留登录状态、设置和素材。请先完成或取消录屏、导出及 Agent 任务，再关闭旧版本。"
LangString HelsteraWelcomeText 1033 "Create, record your screen and export videos from your desktop.$\r$\n$\r$\nInstalling for the current user does not require administrator access. You can choose the install folder next.$\r$\n$\r$\nUpdates preserve your settings and saved media. Finish or cancel recording, export and Agent tasks before closing the previous version."
LangString HelsteraUninstallTitle 2052 "卸载 Helstera"
LangString HelsteraUninstallTitle 1033 "Uninstall Helstera"
LangString HelsteraUninstallText 2052 "此操作移除桌面应用。登录状态和设置会保留在当前用户目录；你选择的本地素材与导出文件夹不会被删除。$\r$\n$\r$\n如果只需升级，请取消卸载并运行新版安装程序。"
LangString HelsteraUninstallText 1033 "This removes the desktop application. Your settings, sign-in state, saved media and exported files will be kept.$\r$\n$\r$\nTo upgrade, cancel this wizard and run the new installer instead."
LangString HelsteraRunning 2052 "Helstera 仍在运行。请先完成或取消录屏、导出和 Agent 任务，再退出应用并点击重试。安装程序不会强制终止任务。"
LangString HelsteraRunning 1033 "Helstera is still running. Finish or cancel recording, export and Agent tasks, then quit the app and click Retry. Setup will not force-stop your tasks."

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(HelsteraWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(HelsteraWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(HelsteraUninstallTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(HelsteraUninstallText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customCheckAppRunning
  StrCpy $R1 0
  helstera_wait_for_exit:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
      ${andIf} $R1 < 10
        IntOp $R1 $R1 + 1
        Sleep 1000
        Goto helstera_wait_for_exit
      ${endIf}
      ${if} ${Silent}
        SetErrorLevel 1618
        Quit
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(HelsteraRunning)" /SD IDCANCEL IDRETRY helstera_wait_for_exit
      SetErrorLevel 1618
      Quit
    ${endIf}
!macroend
