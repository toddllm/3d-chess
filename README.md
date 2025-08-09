# 3D Chess (Browser) with LAN Multiplayer and Modes

A modern Three.js chessboard playable in the browser:
- Single-player classic chess with animations and camera flip
- LAN/remote two-player via a headless Node WS relay
- Game modes: Classic, Portal Rush (portals), Sudden Death (first capture wins), Puzzles (mate-in-N)
- Visual indicators, promotion UI, portal and capture markers

## Quick start (dev)

- Requirements: Node 18+
- Install and run dev server:
  ```bash
  npm install
  npm run dev
  ```
- Open the local URL printed by Vite (defaults to `http://localhost:5173`).

## Build

```bash
npm run build
```
Build artifacts in `dist/`.

## Headless server (LAN/remote relay)

The relay serves the built client and a WebSocket endpoint under `/ws`.

### Files to deploy
- `dist/` (built static client)
- `server.js` (rename to `server.mjs` on server if using ESM)
- Optional: `additions/` (extra docs/images served under `/additions/*`)

### One-time systemd setup (Ubuntu)

1) Copy files to the target directory (e.g., `/opt/lan-3d-chess`)
2) Rename `server.js` to `server.mjs` on the server
3) Run systemd setup (as root):
   ```bash
   sudo ./scripts/setup-systemd.sh /opt/lan-3d-chess 5174 /usr/bin/node
   ```
4) Service should start automatically. Check status:
   ```bash
   systemctl status lan-3d-chess
   ```

### Manual run (no systemd)

```bash
node server.mjs
```
Server runs on `http://<host>:5174`.

### Firewall

```bash
sudo ufw allow 5174/tcp
```

## Multiplayer usage

- Navigate to `http://<server>:5174`
- Enter your WS URL in the Server field (e.g., `ws://<server>:5174`)
- Click "Create LAN Game"; copy the invite link and share it
- Invite includes `server=` so peers auto-connect to the same relay
- Each player gets White/Black automatically and views from behind their color

## Modes

- Classic: Standard rules
- Portal Rush: Two portal squares teleport non-king pieces to the paired portal if the destination is empty; rerolls every few plies. Colored rings show portals.
- Sudden Death: First capture ends the game. Winner is shown in a banner; Play again resets.
- Puzzles: Select from built-in mate-in-N positions. Progress UI shows moves used; Auto-next on solve optionally advances.

## URL deep links

- `?mode=puzzles&puzzle=2` selects Puzzles and puzzle index 2
- `?mode=lan&game=XXXXXX&server=ws://host:5174` auto-joins the LAN game on the given server

## Scripts

- `scripts/setup-systemd.sh`: install a systemd service for the server
- `scripts/deploy.sh user@server:/opt/lan-3d-chess`: build and deploy to server, then restart service
- `scripts/backup.sh user@server:/opt/lan-3d-chess [archive.tgz]`: create a tarball backup of current deployment

## Roles and responsibilities

- User/Player:
  - Use the browser app via `http://<server>:5174` or dev url
  - Choose game mode, move pieces, solve puzzles
  - In LAN mode, exchange the invite link with your opponent

- Admin/Operator:
  - Provision the server (Ubuntu 24.04+), open firewall
  - Deploy `dist/`, `server.mjs`, and optionally `additions/`
  - Setup systemd using `setup-systemd.sh` or run `node server.mjs`
  - Monitor `systemctl status lan-3d-chess` and logs (`journalctl -u lan-3d-chess`)
  - Update via `scripts/deploy.sh` and back up with `scripts/backup.sh`

- Developer:
  - Use `npm run dev` and `npm run build`
  - Modify `src/` for app code and `server.js` for the relay
  - Add puzzles in `src/puzzles.ts` and modes in `src/modes.ts`

## Troubleshooting

- Browser cannot connect to WS: ensure Server field is correct (e.g., `ws://server:5174`) and that port 5174 is open
- Invite link not working: verify that the `server=` param reflects the public/LAN hostname
- Unable to start server: rename `server.js` to `server.mjs` and ensure Node >= 18
- Large bundle size warnings: acceptable for now; future work can code-split and lazy-load Three extras

## Roadmap (short)

- Expand puzzles and add a boss challenge mini-game
- Better portal visuals and configurable rules
- WebRTC transport option with a public signaling server

