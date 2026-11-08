# ReliquarySSH

Cross-platform terminal client with an encrypted, file-based sync — an alternative to
Termius/Terminus.

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
| 7 | E2EE + sync | done — file based, no server |
| 8 | Polish, packaging, roadmap | done |

Per-stage reports live in the Obsidian vault, under `GitHubProjects/ReliquarySSH/`.

## Architecture

```
/app          Electron main process, preload bridge, IPC handlers
/renderer     React UI — components, styles, hooks, services
/protocols    Protocol adapters (ssh, sftp, ftp, telnet, serial) + shared adapter core
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
  AES-256-GCM before they reach the sync file.

## Sync — one file, carried by hand

There is **no server and no account**. The data travels in one file that the user
carries between the devices himself: a USB stick, a cloud disk, a messenger — whatever
suits.

| Step | What happens |
| --- | --- |
| Export | The app writes `reliquary-sync.json` — every record it knows, encrypted |
| Carry | The user copies the file to the other device |
| Import | The other device reads the file and merges the records it holds |

The file holds ciphertext only: without the master password it tells nobody anything.
The master password derives the AES key (PBKDF2-SHA256, 210 000 iterations), and the
PBKDF2 salt travels with the file, so the same password derives the same key on every
device.

Every device keeps its own replica of a record, so two devices never overwrite each
other. The replicas that came in with a file keep travelling, so a file can be passed
along a chain of devices without losing anything.

Merging is last-write-wins on `(version, updated_at)`. A delete is a tombstone and takes
part in the same comparison. The sync runs on demand, from the Sync section of the
sidebar.

## Development

```sh
npm install
npm run dev        # start Electron with Vite HMR
npm run typecheck  # tsc for node and web projects
npm run lint       # eslint
npm test           # vitest
npm run build      # production build into out/
npm run package:mac # electron-builder dmg + zip for arm64 and x64
npm run icon       # regenerate build/icon.png and build/icon.icns from build/assets/logo.svg
```

### Verification harnesses

Every stage has a GUI harness that drives the real app over the Chrome DevTools
Protocol, against a real SSH server:

```sh
node --experimental-strip-types scripts/verify-stage2.ts
node --experimental-strip-types scripts/verify-stage3.ts
node --experimental-strip-types scripts/verify-stage4.ts
node --experimental-strip-types scripts/verify-stage5.ts
node --experimental-strip-types scripts/verify-key-auth.ts
node --experimental-strip-types scripts/verify-host-form.ts
node --experimental-strip-types scripts/verify-export.ts
node --experimental-strip-types scripts/verify-sync-file.ts
node --experimental-strip-types scripts/verify-i18n.ts
```

The icon and the interface can be looked at without a window on the desktop:

```sh
node --experimental-strip-types scripts/shoot-ui.ts russian /tmp/rel.png
```

## Roadmap

- Windows and Linux builds (electron-builder targets are already prepared, commented out).
- FTP, Telnet and Serial protocol support.
- Host key verification (the client does not check the key of the host yet).
- The device secret moved into the OS keychain (`safeStorage`).
- Schema migrations for the local database.
