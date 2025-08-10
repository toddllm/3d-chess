// Simple LAN WebSocket relay for 2-player games
// Run: node server.js

import http from 'http';
import { WebSocketServer } from 'ws';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import path from 'path';
import url from 'url';
import os from 'os';
import { spawn } from 'child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const additionsDir = path.join(__dirname, 'additions');
const miniGamesDir = path.join(__dirname, 'src', 'minigames');
const pythonGamesDir = path.join(__dirname, 'python_games');

// In-memory game rooms
const rooms = new Map(); // gameId -> { clients: Set<ws>, colorByClient: Map<ws,'w'|'b'>, fen: string }

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    // API: health
    if (parsed.pathname === '/api/minigames/ping') {
      return json(res, { ok: true, message: 'minigames api online' });
    }
    // API: list minigames
    if (parsed.pathname === '/api/minigames/list') {
      try {
        await mkdir(miniGamesDir, { recursive: true });
        await mkdir(pythonGamesDir, { recursive: true });
        const ts = (await readdir(miniGamesDir)).filter(f => f.endsWith('.ts'));
        const py = (await readdir(pythonGamesDir)).filter(f => f.endsWith('.py'));
        return json(res, { ok: true, ts, py });
      } catch (e) {
        return json(res, { ok: false, error: String(e) }, 500);
      }
    }
    // API: generate new minigame via Ollama
    if (parsed.pathname === '/api/minigames/generate' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!body || typeof body !== 'object') return json(res, { ok: false, error: 'Invalid JSON body' }, 400);
        const requestedName = typeof body.name === 'string' ? body.name : '';
        const name = sanitizeName(requestedName) || `autogen-${Date.now()}`;
        const spec = String(body?.spec || 'Create a simple Portal Rush variant.');
        const template = String(body?.template || 'mode');
        const model = process.env.OLLAMA_MODEL || 'gpt-oss:120b';
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
        if (template === 'python') {
          await mkdir(pythonGamesDir, { recursive: true });
          const targetBase = await ensureUniquePyFilename(path.join(pythonGamesDir, `${name}.py`));
          const result = await generatePythonWithRetries({ baseUrl, model, spec, targetBase, maxAttempts: 3 });
          return json(res, result, result.ok ? 200 : 422);
        } else {
          await mkdir(miniGamesDir, { recursive: true });
          const targetBase = await ensureUniqueTsFilename(path.join(miniGamesDir, `${name}.ts`));
          const result = await generateWithRetries({ baseUrl, model, template, spec, targetBase, cwd: __dirname, maxAttempts: 3 });
          return json(res, result, result.ok ? 200 : 422);
        }
      } catch (e) {
        return json(res, { ok: false, error: String(e) }, 500);
      }
    }
    // API: QA existing minigame
    if (parsed.pathname === '/api/minigames/qa') {
      const file = parsed.searchParams.get('file');
      if (!file) return json(res, { ok: false, error: 'file query param required' }, 400);
      try {
        if (file.endsWith('.ts')) {
          const full = path.join(miniGamesDir, file);
          const content = await readFile(full, 'utf-8');
          const qa = quickQA(content);
          return json(res, { ok: qa.ok, details: qa });
        } else if (file.endsWith('.py')) {
          const full = path.join(pythonGamesDir, file);
          const qa = await runPythonQA(full);
          return json(res, qa, qa.ok ? 200 : 422);
        } else {
          return json(res, { ok: false, error: 'unsupported file type' }, 400);
        }
      } catch (e) {
        return json(res, { ok: false, error: String(e) }, 404);
      }
    }
    // Serve additions from /additions/* if present
    if (parsed.pathname.startsWith('/additions/')) {
      const addPath = parsed.pathname.replace('/additions/', '');
      const filePath = path.join(additionsDir, addPath);
      if (!filePath.startsWith(additionsDir)) { res.writeHead(403); res.end('Forbidden'); return; }
      try {
        const content = await readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const type =
          ext === '.md' ? 'text/markdown' :
          ext === '.png' ? 'image/png' :
          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
          ext === '.webp' ? 'image/webp' :
          ext === '.gif' ? 'image/gif' :
          'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(content);
        return;
      } catch {
        res.writeHead(404); res.end('Not found'); return;
      }
    }

    // Serve built files from dist/ with fallback to index.html
    let filePath = path.join(distDir, parsed.pathname === '/' ? '/index.html' : parsed.pathname);
    // Basic security
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let content;
    try {
      content = await readFile(filePath);
    } catch {
      // Fallback to index.html for SPA routes
      const indexPath = path.join(distDir, 'index.html');
      content = await readFile(indexPath);
      // Inject LAN IP for client-side share link if available
      const lanIp = detectLanIPv4();
      if (lanIp) {
        content = Buffer.from(String(content).replace('</head>', `<script>window.__LAN_IP__='${lanIp}'</script></head>`));
      }
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request, client) => {
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  const gameId = urlObj.searchParams.get('game');
  if (!gameId) { ws.close(); return; }

  if (!rooms.has(gameId)) rooms.set(gameId, { clients: new Set(), colorByClient: new Map(), fen: undefined });
  const room = rooms.get(gameId);
  room.clients.add(ws);

  // Assign color
  let color = 'w';
  const colorsInUse = new Set(room.colorByClient.values());
  if (!colorsInUse.has('w')) color = 'w'; else if (!colorsInUse.has('b')) color = 'b'; else color = Math.random() < 0.5 ? 'w' : 'b';
  room.colorByClient.set(ws, color);

  ws.send(JSON.stringify({ type: 'assign', color }));
  if (room.fen) ws.send(JSON.stringify({ type: 'state', fen: room.fen }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello' && msg.gameId === gameId) {
        // Respond with latest state
        if (room.fen) ws.send(JSON.stringify({ type: 'state', fen: room.fen }));
      } else if (msg.type === 'move' && msg.gameId === gameId) {
        room.fen = msg.fen;
        // Broadcast to others
        for (const client of room.clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'move', move: msg.move, fen: msg.fen }));
          }
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    room.colorByClient.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(gameId);
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  if (urlObj.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 5174;
server.listen(PORT, () => {
  const ip = detectLanIPv4();
  console.log(`Server running on http://localhost:${PORT}`);
  if (ip) console.log(`LAN: http://${ip}:${PORT}`);
});

function detectLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        // Private ranges
        if (
          net.address.startsWith('10.') ||
          net.address.startsWith('192.168.') ||
          net.address.startsWith('172.16.') ||
          net.address.startsWith('172.17.') ||
          net.address.startsWith('172.18.') ||
          net.address.startsWith('172.19.') ||
          net.address.startsWith('172.20.') ||
          net.address.startsWith('172.21.') ||
          net.address.startsWith('172.22.') ||
          net.address.startsWith('172.23.') ||
          net.address.startsWith('172.24.') ||
          net.address.startsWith('172.25.') ||
          net.address.startsWith('172.26.') ||
          net.address.startsWith('172.27.') ||
          net.address.startsWith('172.28.') ||
          net.address.startsWith('172.29.') ||
          net.address.startsWith('172.30.') ||
          net.address.startsWith('172.31.')
        ) return net.address;
      }
    }
  }
  return null;
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sanitizeName(n) {
  return String(n).toLowerCase().replace(/[^a-z0-9\-_.]/g, '-').slice(0, 64);
}

function buildMiniGamePrompt(template, spec) {
  if (template === 'mode') {
    return (
`You are generating a TypeScript module for a chess mini-game mode in a Three.js browser app.
Output ONLY the code for a single TypeScript file, no backticks.\n\nConstraints:\n- The file must export a function createModeRuntime(): { onReset?(chess: any): void; beforeMove?(chess: any, move: {from:string; to:string; promotion?: 'q'|'r'|'b'|'n'}): void; afterAppliedMove?(chess: any, applied: any): void; getStatusExtra?(): string | null; dispose?(): void }\n- No external imports besides things available in the app's codebase (no Node imports). You may rely on the chess.js API via the chess argument.\n- Keep it self-contained; no side effects except returning handlers.\n\nImplement a fun, lightweight mini-game mode according to this spec:\n${spec}\n`
    );
  }
  return `Generate a TypeScript module for this chess mini-game concept. Output only code. Spec: ${spec}`;
}

async function ollamaGenerate(baseUrl, model, prompt) {
  const resp = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!resp.ok) throw new Error(`ollama http ${resp.status}`);
  const data = await resp.json();
  return data.response || '';
}

function runBuild(cwd) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], { cwd, shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      resolve({ success: code === 0, code, stdout: out, stderr: err });
    });
  });
}

async function ensureUniqueTsFilename(basePath) {
  let p = basePath;
  let i = 1;
  const dir = path.dirname(basePath);
  const base = path.basename(basePath, '.ts');
  const ext = '.ts';
  const existing = new Set(await readdir(dir));
  while (existing.has(path.basename(p))) {
    p = path.join(dir, `${base}-${i}${ext}`);
    i++;
  }
  return p;
}

async function ensureUniquePyFilename(basePath) {
  let p = basePath;
  let i = 1;
  const dir = path.dirname(basePath);
  const base = path.basename(basePath, '.py');
  const ext = '.py';
  const existing = new Set(await readdir(dir));
  while (existing.has(path.basename(p))) {
    p = path.join(dir, `${base}-${i}${ext}`);
    i++;
  }
  return p;
}

function extractCode(raw) {
  if (!raw) return '';
  // If the model wrapped with ``` blocks, strip them
  const triple = /```[a-zA-Z]*[\r\n]+([\s\S]*?)```/m;
  const m = raw.match(triple);
  return (m ? m[1] : raw).trim();
}

function quickQA(code) {
  const result = { ok: true, issues: [] };
  if (!code || code.length < 20) { result.ok = false; result.issues.push('too-short'); }
  if (!/export\s+function\s+createModeRuntime\s*\(/.test(code)) {
    result.ok = false; result.issues.push('missing-createModeRuntime');
  }
  // Check it returns an object with getStatusExtra at least
  if (!/getStatusExtra\s*\(\)/.test(code)) {
    result.issues.push('missing-getStatusExtra');
  }
  return result;
}

async function generatePythonWithRetries({ baseUrl, model, spec, targetBase, maxAttempts = 3 }) {
  let last = { ok: false, details: null };
  let filename = targetBase;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPythonGamePrompt(spec);
    const raw = await ollamaGenerate(baseUrl, model, prompt);
    const code = extractCode(raw);
    const qa = pythonQuickQA(code);
    if (!qa.ok) { last = { ok: false, details: { attempt, qa } }; continue; }
    filename = await ensureUniquePyFilename(targetBase);
    await writeFile(filename, code, 'utf-8');
    const run = await runPythonQA(filename);
    if (run.ok) {
      return { ok: true, file: `/python_games/${path.basename(filename)}`, usedName: path.basename(filename), test: run };
    }
    last = { ok: false, details: { attempt, run } };
  }
  return { ok: false, error: 'python-generation-failed', ...last };
}

function buildPythonGamePrompt(spec) {
  return (
`You are generating a standalone Python 3 mini-game script.
Output ONLY code, no backticks. Requirements:
- The script must be executable with: python3 file.py --selftest
- When run with --selftest it returns exit code 0 on success and prints a short line with 'OK'.
- No external pip deps. Use only Python standard library.
- Implement a simple text-based mini-game logic described by this spec:
${spec}
`);
}

function pythonQuickQA(code) {
  const result = { ok: true, issues: [] };
  if (!code || code.length < 20) { result.ok = false; result.issues.push('too-short'); }
  if (!/--selftest/.test(code)) { result.ok = false; result.issues.push('missing-selftest-arg'); }
  return result;
}

async function runPythonQA(filePath) {
  return new Promise((resolve) => {
    const py = spawn('python3', [filePath, '--selftest']);
    let out = '';
    let err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      resolve({ ok: code === 0 && /OK/i.test(out), code, stdout: out, stderr: err });
    });
  });
}

async function generateWithRetries({ baseUrl, model, template, spec, targetBase, cwd, maxAttempts = 3 }) {
  let last = { ok: false, details: null };
  let filename = targetBase;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildMiniGamePrompt(template, spec);
    const raw = await ollamaGenerate(baseUrl, model, prompt);
    const code = extractCode(raw);
    const qa = quickQA(code);
    if (!qa.ok) {
      last = { ok: false, details: { attempt, qa } };
      continue;
    }
    // If model embedded a different name in code, we still use our targetBase; ensure unique
    filename = await ensureUniqueTsFilename(targetBase);
    await writeFile(filename, code, 'utf-8');
    const build = await runBuild(cwd);
    if (build.success) {
      return { ok: true, file: `/src/minigames/${path.basename(filename)}`, usedName: path.basename(filename), build };
    }
    last = { ok: false, details: { attempt, build } };
  }
  return { ok: false, error: 'generation-failed', ...last };
}
