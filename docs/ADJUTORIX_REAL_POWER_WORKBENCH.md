# Adjutorix Real Power Workbench

Adjutorix now exposes a real desktop workbench spine:

- main-process workspace IPC
- preload bridge exposed as `window.adjutorixPower`
- native open-repository dialog
- workspace tree scanning
- file reading into editor tabs
- Monaco editor surface
- draft preservation into `.adjutorix/workbench-drafts`
- intent plan object writing into `.adjutorix/objects`
- real governed terminal command execution inside the opened workspace
- git status / diff stat command
- build verification command
- assistant intent capture
- governance status panel
- terminal-backed evidence timeline

The renderer is no longer only a static cockpit. It is connected to the Electron main process through a typed workbench bridge.
