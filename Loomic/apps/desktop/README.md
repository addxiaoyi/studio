# Helstera Desktop

Helstera Desktop opens the production website at `https://studio.0st.top/` in its main window. The trusted site receives the Electron preload bridge for local browser assistance and desktop update controls. External links open in the system browser.

## Development

Install the workspace dependencies, then run the desktop app:

```bash
pnpm install
pnpm --filter @helstera/shared build
pnpm --filter @helstera/desktop dev
```

To point an unpackaged development build at a local or staging website, set `HELSTERA_DESKTOP_URL` to that site's origin before starting Electron.

## Build

```bash
pnpm --filter @helstera/shared build
pnpm --filter @helstera/desktop build
```

Release packages and publish updater manifests with `scripts/release-desktop.py` from the repository root. See `docs/tech/desktop-release.md` for platform requirements.
