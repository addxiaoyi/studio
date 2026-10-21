# Website Capture

Website capture has two browser modes:

- `isolated`: a short-lived Playwright Chromium context. It accepts only HTTP(S), revalidates DNS for every request, blocks private/link-local/loopback addresses, rejects credentials and non-GET requests, and caps pages, bytes, screenshots, and recordings.
- `local`: a Chrome/Edge MV3 assistant. The user creates a ten-minute pairing code in Settings, installs/loads `apps/browser-assistant`, and connects the selected tab over outbound WSS. The code is single-use; the returned session token remains valid until the user disconnects or revokes it.

The assistant sends DOM facts and screenshots only. It does not request cookie, webRequest, password, or browser-storage permissions. Local URLs must be entered exactly by the user; private host auto-follow cannot expand to another private hostname. Web content is untrusted, and side-effect messages are denied unless a future confirmation flow explicitly approves them.

The authenticated API lives under `/api/website-capture`:

- `POST /pairings`, `GET /assistant`, `POST /assistant/pause`, `POST /assistant/resume`, `POST /assistant/revoke`
- `POST /` and `GET /:taskId`
- `POST /:taskId/cancel`, `POST /:taskId/retry`, `POST /:taskId/promo/prepare`
- WSS: `/api/website-capture/assistant/ws?code=...` for the one-time code, or `session_token=...` for a reconnect

Promotional videos are opt-in and default to Chinese, 30 seconds, and `9:16`. They reuse `generation_approvals`: the selected model, estimated credits, duration, and reference screenshots are shown before a job is created or credits are charged. A rejection does not create a video job and the result is never auto-published.

## Extension smoke test

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Load `Loomic/apps/browser-assistant` as an unpacked extension.
3. In Helstera Settings, create a pairing code and paste it into the extension popup.
4. Open the exact target URL in the selected tab, then ask the Agent to browse it with `mode: local`.

The Settings page exposes pairing status, pause, revoke, and the disclosure text. The chat progress card exposes page evidence, recording, local/isolated status, and the optional promo approval card.

The current automated coverage checks the URL policy, MV3 permission boundary, task state machine, isolated SSRF controls, promo approval plumbing, and the shared Server/Web typechecks. Full three-OS Chrome/Edge validation still requires running the unpacked extension on each host.
