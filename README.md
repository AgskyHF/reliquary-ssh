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
| 5 | Keychain (key generation, import, export) | done |
| 6 | Local storage (SQLite, repositories, outbox) | done |
| 7 | Backend + auth (Google OAuth PKCE, email/password) | done |
| 8 | E2EE + sync | done |
| 9 | Polish, packaging, roadmap | done |

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
- The master password never leaves the device: hosts and keys are encrypted with
  AES-256-GCM before they reach the backend.

## Sync

The backend stores opaque blobs — it never sees a host name, a user name or a key.
The master password derives the AES key (PBKDF2-SHA256), and the PBKDF2 salt travels
with the account, so a second device derives the same key from the same password and
reads the data of the first one.

Merging is last-write-wins on `(version, updated_at)`. A delete is a tombstone and
takes part in the same comparison. The sync runs on demand, from the Sync section of
the sidebar.

## Development

```sh
npm install
npm run dev        # start Electron with Vite HMR
npm run typecheck  # tsc for node and web projects
npm run lint       # eslint
npm test           # vitest
npm run build      # production build into out/
npm run package:mac # electron-builder dmg + zip for arm64 and x64
python3 scripts/make-icon.py  # regenerate build/icon.png and build/icon.icns
```

The backend runs separately:

```sh
JWT_SECRET=dev-secret npm run server   # http://127.0.0.1:8790
```

The address of the backend can also be changed in the Settings section of the app.

### Verification harnesses

Every stage has a GUI harness that drives the real app over the Chrome DevTools
Protocol, against a real backend and a real SSH server:

```sh
node --experimental-strip-types scripts/verify-stage2.ts
node --experimental-strip-types scripts/verify-stage3.ts
node --experimental-strip-types scripts/verify-stage4.ts
node --experimental-strip-types scripts/verify-stage5.ts
node --experimental-strip-types scripts/verify-key-auth.ts
node --experimental-strip-types scripts/verify-stage7.ts
node --experimental-strip-types scripts/verify-stage8.ts
node --experimental-strip-types scripts/verify-stage9.ts
```

## Roadmap

- Windows and Linux builds (electron-builder targets are already prepared, commented out).
- FTP, Telnet and Serial protocol support.
- Google OAuth with a real client id (the flow is written, but untested live).
- Automatic sync on a timer and on local changes.
- A form to create and edit hosts.
- The device secret moved into the OS keychain (`safeStorage`).
- Schema migrations for the local database.
