# Adjutorix IDE Workbench Powerup

Adjutorix is now presented as a human IDE-style workbench rather than a cockpit-only status screen.

The renderer surface includes:

- activity rail
- repository explorer shell
- Monaco editor
- command palette
- governed terminal panel
- problems/output panels
- operator assistant panel
- governance gate panel
- evidence timeline panel
- status bar
- workspace-aware action gating

The workbench is designed to bind existing main-process IPC surfaces when exposed through the preload bridge while remaining operable as a renderer shell.
