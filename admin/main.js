const host = location.origin;

const nameEl = document.getElementById('name');
const templateEl = document.getElementById('template');
const specEl = document.getElementById('spec');
const generateBtn = document.getElementById('generateBtn');
const genResultEl = document.getElementById('genResult');

const refreshBtn = document.getElementById('refreshBtn');
const pyListEl = document.getElementById('pyList');
const tsListEl = document.getElementById('tsList');
const qaResultEl = document.getElementById('qaResult');

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  try { return { ok: res.ok, json: JSON.parse(text) }; } catch { return { ok: res.ok, text } }
}

async function refresh() {
  pyListEl.innerHTML = '';
  tsListEl.innerHTML = '';
  const { ok, json } = await api('/api/minigames/list');
  if (!ok) return;
  (json.py || []).forEach(f => addListItem(pyListEl, f));
  (json.ts || []).forEach(f => addListItem(tsListEl, f));
}

function addListItem(ul, file) {
  const li = document.createElement('li');
  li.textContent = file + ' ';
  const qaBtn = document.createElement('button');
  qaBtn.textContent = 'QA';
  qaBtn.addEventListener('click', async () => {
    qaResultEl.textContent = 'Running QA...';
    const { ok, json, text } = await api(`/api/minigames/qa?file=${encodeURIComponent(file)}`);
    qaResultEl.textContent = ok ? JSON.stringify(json, null, 2) : text || 'error';
  });
  li.appendChild(qaBtn);
  ul.appendChild(li);
}

generateBtn.addEventListener('click', async () => {
  genResultEl.textContent = 'Generating... (local)';
  const body = { name: nameEl.value || 'mini', template: templateEl.value, spec: specEl.value };
  const { ok, json, text } = await api('/api/minigames/generate', { method: 'POST', body: JSON.stringify(body) });
  genResultEl.textContent = ok ? JSON.stringify(json, null, 2) : text || 'error';
  await refresh();
});

refreshBtn.addEventListener('click', refresh);

refresh();
