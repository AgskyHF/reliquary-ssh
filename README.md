# ReliquarySSH

Cross-platform terminal client with encrypted sync — an alternative to Termius/Terminus.

Electron + React + TypeScript. SSH and SFTP are the MVP protocols; FTP, Telnet and Serial
are reserved in the protocol interface but not implemented yet.

## Status

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Project skeleton, configs, shared types, base layout | done |
| 2 | SSH adapter + xterm.js terminal | done |
| 3 | Tabs and multi-session | done |
| 4 | SFTP file manager | done |
| 5 | Keychain (key generation, import, export) | planned |
| 6 | Local storage (SQLite, repositories, outbox) | planned |
| 7 | Backend + auth (Google OAuth PKCE, email/password) | planned |
| 8 | E2EE + sync | planned |
| 9 | Polish, packaging, roadmap | planned |

Per-stage reports live in the Obsidian vault, under `GitHubProjects/ReliquarySSH/`.

## Architecture

```
/app          Electron main process, preload bridge, IPC handlers
/renderer     React UI — components, styles, hooks, services
/protocols    Protocol adapters (ssh, sftp, ftp, telnet, serial) + shared adapter core
/server       Express + SQLite sync backend
/shared       Types shared by all layers (entities, enums, SyncBlob, IPC channels)
```

Rules that hold across the whole codebase:

- TypeScript strict mode.
- The renderer never touches SQLite or SSH directly — only through `renderer/src/services/api.ts`.
- Protocol implementations are pluggable behind the `ConnectionAdapter` interface.
- Styling goes through CSS variables in `renderer/src/styles/theme.css`; no hardcoded
  colors, spacing or fonts in components.
- No macOS-only APIs without an abstraction layer.
- Secrets live in `.env` (see `.env.example`), never in the repository.
- Private keys are stored encrypted at rest, never in plaintext.

## Development

```sh
npm install
npm run dev        # start Electron with Vite HMR
npm run typecheck  # tsc for node and web projects
npm run lint       # eslint
npm test           # vitest
npm run build      # production build into out/
npm run package:mac # electron-builder dmg + zip for arm64 and x64
```

## Roadmap

- Windows and Linux builds (electron-builder targets are already prepared, commented out).
- FTP, Telnet and Serial protocol support.
- Google OAuth and email authentication with the sync backend.
- End-to-end encrypted sync of hosts, keys and settings.
