# MarkEdit for Windows

This directory contains an unofficial Electron host for MarkEdit's original
`CoreEditor`. It adds a default read-only view, Markdown section copying,
theme customization, a collapsible file sidebar, Windows file dialogs,
Markdown file associations, unsaved-change protection, and an NSIS installer.

## Build

```powershell
corepack yarn --cwd ..\CoreEditor install --immutable
corepack yarn --cwd ..\CoreEditor build
npm ci
npm run test:windows
npm run dist
```

The installer is written to `dist`.
