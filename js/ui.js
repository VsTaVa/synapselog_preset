// ── 스토리지 시스템 ──────────────────────────────────────────────────

let _useLocalStorage = localStorage.getItem('snlog_use_local') === 'true';
let _storageScopes = (() => { try { return JSON.parse(localStorage.getItem('snlog_scopes') || '{}'); } catch(e) { return {}; } })();
['pages','slider','connect'].forEach(k => { if (_storageScopes[k] === undefined) _storageScopes[k] = true; });
let _exportSize = parseInt(localStorage.getItem('snlog_export_size') || '2048');

function getStorage(scope) {
  if (_useLocalStorage && _storageScopes[scope] !== false) return localStorage;
  return sessionStorage;
}
function snSet(key, value, scope) {
  const s = scope ? getStorage(scope) : sessionStorage;
  try { s.setItem(key, value); } catch(e) {}
}
function snGet(key, scope) {
  if (scope && _useLocalStorage && _storageScopes[scope] !== false) {
    const lv = localStorage.getItem(key);
    if (lv !== null) return lv;
  }
  return sessionStorage.getItem(key);
}
function snRemove(key, scope) {
  sessionStorage.removeItem(key);
  if (scope) localStorage.removeItem(key);
}

let _favoritePageIds = new Set((() => { try { return JSON.parse(snGet('snlog_favorites', 'pages') || '[]'); } catch(e) { return []; } })());
function toggleFavorite(pageId) {
  if (_favoritePageIds.has(pageId)) _favoritePageIds.delete(pageId); else _favoritePageIds.add(pageId);
  snSet('snlog_favorites', JSON.stringify([..._favoritePageIds]), 'pages');
  refreshSidebarRender();
}

// ── DOM 레퍼런스 & 캔버스 초기화 ─────────────────────────────────────

canvas = document.getElementById('c');
ctx = canvas.getContext('2d');
DPR = window.devicePixelRatio || 1;
W = window.innerWidth; H = window.innerHeight;
canvas.width = W * DPR; canvas.height = H * DPR;
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
WORLD_CX = W / 2; WORLD_CY = H / 2;

const tooltip = document.getElementById('tooltip');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const cfgRep = document.getElementById('cfg-rep');
const cfgGrav = document.getElementById('cfg-grav');
const cfgTension = document.getElementById('cfg-tension');
const cfgNodeSize = document.getElementById('cfg-node-size');
const cfgLinkWidth = document.getElementById('cfg-link-width');
const vRep = document.getElementById('v-rep');
const vGrav = document.getElementById('v-grav');
const vTension = document.getElementById('v-tension');
const vNodeSize = document.getElementById('v-node-size');
const vLinkWidth = document.getElementById('v-link-width');
const detailPanel = document.getElementById('detail-panel');

// ── 그래프 설정 슬라이더 ──────────────────────────────────────────────

function updateConfig() {
  CONFIG.repulsion = parseFloat(cfgRep.value);
  CONFIG.gravity = parseFloat(cfgGrav.value);
  CONFIG.linkTension = parseFloat(cfgTension.value);
  CONFIG.nodeSize = parseFloat(cfgNodeSize.value);
  CONFIG.linkWidth = parseFloat(cfgLinkWidth.value);
  vRep.textContent = Math.round(parseFloat(cfgRep.value) / 100);
  vGrav.textContent = Math.round(parseFloat(cfgGrav.value) * 10000);
  vTension.textContent = Math.round(parseFloat(cfgTension.value) * 1000);
  vNodeSize.textContent = parseFloat(cfgNodeSize.value).toFixed(1);
  vLinkWidth.textContent = parseFloat(cfgLinkWidth.value).toFixed(1);
  isStable = false;
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
  snSet('snlog_slider', JSON.stringify({ rep: cfgRep.value, grav: cfgGrav.value, tension: cfgTension.value, nodeSize: cfgNodeSize.value, linkWidth: cfgLinkWidth.value }), 'slider');
}
cfgRep.addEventListener('input', updateConfig);
cfgGrav.addEventListener('input', updateConfig);
cfgTension.addEventListener('input', updateConfig);
cfgNodeSize.addEventListener('input', updateConfig);
cfgLinkWidth.addEventListener('input', updateConfig);

// ── 로딩 오버레이 ─────────────────────────────────────────────────────

function showLoading(text='불러오는 중...') {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (el) el.classList.add('visible');
  if (txt) txt.textContent = text;
}
function setLoadingText(text) { const txt = document.getElementById('loading-text'); if (txt) txt.textContent = text; }
function hideLoading() { const el = document.getElementById('loading-overlay'); if (el) el.classList.remove('visible'); }

// ── 제목 표시 토글 ────────────────────────────────────────────────────

function toggleLabels() { const cb = document.getElementById('label-toggle-input'); _showLabels = cb ? cb.checked : !_showLabels; }

// ── 포커스 모드 ────────────────────────────────────────────────────────

function applyFocusMode(nodeId, shallow = false) {
  if (!_focusMode) return;
  _focusNodeId = nodeId;
  const connectedIds = new Set([nodeId]);
  if (shallow) {
    edges.forEach(e => {
      if (e.from === nodeId) connectedIds.add(e.to);
      if (e.to === nodeId) connectedIds.add(e.from);
    });
  } else {
    const queue = [nodeId];
    while (queue.length) {
      const id = queue.shift();
      edges.forEach(e => {
        if (e.from === id && !connectedIds.has(e.to)) { connectedIds.add(e.to); queue.push(e.to); }
      });
    }
    edges.forEach(e => { if (e.to === nodeId) connectedIds.add(e.from); });
  }
  edges.forEach(e => {
    if (!e.manualLink) return;
    if (connectedIds.has(e.from)) connectedIds.add(e.to);
    if (connectedIds.has(e.to)) connectedIds.add(e.from);
  });
  nodes.forEach(n => { n.dimmed = !connectedIds.has(n.id); });
  isStable = false;
}

function toggleFocusMode() {
  const cb = document.getElementById('focus-toggle-input');
  _focusMode = cb ? cb.checked : !_focusMode;
  if (!_focusMode) { _focusNodeId = null; nodes.forEach(n => { n.dimmed = false; }); }
  else if (_focusNodeId) applyFocusMode(_focusNodeId);
  isStable = false;
}

// ── 연결 모드 ─────────────────────────────────────────────────────────

function toggleConnectMode() {
  const cb = document.getElementById('connect-toggle-input');
  _connectMode = cb ? cb.checked : !_connectMode;
  if (_connectFirstNode) { _connectFirstNode.connectSelected = false; _connectFirstNode = null; }
  if (!_connectMode) nodes.forEach(n => { n.connectSelected = false; });
  const s = document.getElementById('status');
  if (_connectMode && s) { s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요'; closePanel(); }
  else if (s) s.textContent = '';
  isStable = false;
}

function toggleMultiSelectMode() {
  const cb = document.getElementById('multiselect-toggle-input');
  _multiSelectMode = cb ? cb.checked : !_multiSelectMode;
  if (_multiSelectMode && _editMode) { _editMode = false; const e = document.getElementById('editmode-toggle-input'); if (e) e.checked = false; clearMultiSelect(); }
  if (!_multiSelectMode && typeof clearAllModes === 'function') clearAllModes();
  applyModeCursor();
  isStable = false;
}

function toggleEditMode() {
  const cb = document.getElementById('editmode-toggle-input');
  _editMode = cb ? cb.checked : !_editMode;
  if (_editMode && _multiSelectMode) { _multiSelectMode = false; const m = document.getElementById('multiselect-toggle-input'); if (m) m.checked = false; }
  clearMultiSelect();
  applyModeCursor();
  isStable = false;
}

// 모드별 커서: 선택 모드=주황 손가락, 편집 모드=노드연결(분기) 아이콘
function _editModeCursor() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23ed7000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='5' r='2.4'/><circle cx='5' cy='18' r='2.4'/><path d='M11 7.4V13a3 3 0 0 1-3 3H7.4'/><path d='M16 18h6M19 15v6'/></svg>`;
  return `url("data:image/svg+xml,${svg}") 5 5, pointer`;
}
function _selectModeCursor() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 32 32'><path fill='%23ed7000' d='M12 2a2 2 0 0 0-2 2v12L8.5 14a2.2 2.2 0 0 0-3.1 3.1l4.5 6A6 6 0 0 0 14.7 25H19a6 6 0 0 0 6-6v-7a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0V4a2 2 0 0 0-1-2z'/></svg>`;
  return `url("data:image/svg+xml,${svg}") 10 2, pointer`;
}
function _modeCursor() {
  if (_editMode) return _editModeCursor();
  if (_multiSelectMode) return _selectModeCursor();
  return '';
}
function applyModeCursor() {
  const c = _modeCursor();
  document.body.style.cursor = c; // 클릭 즉시 전역 반영
  if (canvas) canvas.style.cursor = c || 'default';
}

// 편집 모드에서 노드 클릭 → 단일 선택 + 편집 메뉴
function selectForEdit(n) {
  _multiSelected = [n];
  renderMultiSelectMenu();
}

function handleConnectClick(n) {
  const s = document.getElementById('status');
  if (!_connectFirstNode) {
    _connectFirstNode = n; n.connectSelected = true;
    if (s) s.textContent = `"${n.label}" 선택됨 — 연결할 노드를 클릭하세요`;
  } else if (_connectFirstNode.id === n.id) {
    _connectFirstNode.connectSelected = false; _connectFirstNode = null;
    if (s) s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요';
  } else {
    const a = _connectFirstNode, b = n;
    const existingManual = edges.find(e => e.manualLink && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)));
    if (existingManual) {
      removeManualLink(a.id, b.id);
      if (s) s.textContent = `"${a.label}" ↔ "${b.label}" 연결 삭제 — 계속 연결할 노드를 클릭하세요`;
    } else {
      edges.push({ from: a.id, to: b.id, manualLink: true }); saveManualLinks();
      if (s) s.textContent = `"${a.label}" ↔ "${b.label}" 연결됨 — 계속 연결할 노드를 클릭하세요`;
    }
  }
  isStable = false;
}

function saveManualLinks() {
  const manual = edges.filter(e => e.manualLink).map(e => {
    const na = nodeMap[e.from], nb = nodeMap[e.to];
    if (!na || !nb) return null;
    return { from: e.from, to: e.to, fromKey: `${na.sourcePageId || ''}::${na.label}`, toKey: `${nb.sourcePageId || ''}::${nb.label}` };
  }).filter(Boolean);
  snSet('snlog_manual_links', JSON.stringify(manual), 'connect');
}

function loadManualLinks() {
  const saved = snGet('snlog_manual_links', 'connect');
  if (!saved) return;
  let links; try { links = JSON.parse(saved); } catch(e) { return; }
  links.forEach(link => {
    if (link.fromKey && link.toKey) {
      const na = nodes.find(n => `${n.sourcePageId || ''}::${n.label}` === link.fromKey);
      const nb = nodes.find(n => `${n.sourcePageId || ''}::${n.label}` === link.toKey);
      if (na && nb) {
        const exists = edges.some(e => (e.from === na.id && e.to === nb.id) || (e.from === nb.id && e.to === na.id));
        if (!exists) edges.push({ from: na.id, to: nb.id, manualLink: true });
      }
    } else if (link.from && link.to) {
      if (nodeMap[link.from] && nodeMap[link.to]) {
        const exists = edges.some(e => (e.from === link.from && e.to === link.to) || (e.from === link.to && e.to === link.from));
        if (!exists) edges.push({ from: link.from, to: link.to, manualLink: true });
      }
    }
  });
  isStable = false;
}

function removeManualLink(fromId, toId) {
  edges = edges.filter(e => !(e.manualLink && ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))));
  saveManualLinks(); isStable = false;
}

// ── 다중 선택 (Shift+클릭) — 연결/경로찾기/격리 ───────────────────────

function toggleMultiSelect(n) {
  const idx = _multiSelected.indexOf(n);
  if (idx !== -1) { _multiSelected.splice(idx, 1); n.multiSelected = false; }
  else { _multiSelected.push(n); n.multiSelected = true; }
  renderMultiSelectMenu();
  isStable = false;
}

function clearMultiSelect() {
  _multiSelected.forEach(n => { n.multiSelected = false; });
  _multiSelected = [];
  renderMultiSelectMenu();
}

function renderMultiSelectMenu() {
  const menu = document.getElementById('multi-select-menu');
  if (!menu) return;
  if (_multiSelected.length < 1) { menu.classList.remove('open'); menu.innerHTML = ''; return; }
  const n = _multiSelected.length;
  const chainIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const pinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-1.5a3 3 0 0 1-.88-2.12V8a5 5 0 0 0-10 0v5.38a3 3 0 0 1-.88 2.12L5 17z"/></svg>`;
  const focusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2"/></svg>`;
  if (_editMode) { renderEditMenu(menu); return; }
  let html = '';
  if (n === 1) {
    html += `<button onclick="multiSelectStartConnect()" title="이 노드를 시작점으로, 클릭하는 다른 노드들과 차례로 연결합니다">${chainIcon} 노드 다중 연결</button>`;
    html += `<button onclick="multiSelectFocus()" title="이 노드와 연결된 가지만 남기고 나머지를 흐리게 표시합니다">${focusIcon} 포커스 모드</button>`;
  } else if (n === 2) {
    html += `<button onclick="multiSelectConnect()" title="선택한 두 노드를 연결합니다. 이미 연결돼 있으면 해제합니다">${chainIcon} 노드 간 연결</button>`;
  } else {
    html += `<button onclick="multiSelectChainConnect()" title="선택한 순서대로(1→2→3…) 인접한 노드끼리 연결합니다">${chainIcon} 순서대로 연결</button>`;
  }
  html += `<button onclick="multiSelectPath()" title="${n === 1 ? '이 노드에서 최상위까지의 경로를 표시합니다' : '선택한 노드들 사이의 최단 경로만 표시합니다'}">↔ 경로 찾기</button>`;
  const satOn = _multiSelected.every(nd => nd._satelliteRoot);
  html += `<button onclick="multiSelectSatellite()" title="선택한 노드와 하위 노드를 상위에서 분리해 바깥 궤도로 띄웁니다. 같은 노드를 다시 선택해 누르면 복원됩니다">◌ 위성 모드${satOn ? ' 해제' : ''}</button>`;
  html += `<button onclick="multiSelectPin()" title="선택한 노드의 위치를 고정하거나 해제합니다">${pinIcon} 고정/해제</button>`;
  menu.innerHTML = html;
  menu.classList.add('open');
  repositionMultiSelectMenu();
}

// 노드 편집 모드: 단일 노드에 대한 추가/삭제 메뉴
function renderEditMenu(menu) {
  const node = _multiSelected[0];
  if (!node) { menu.classList.remove('open'); menu.innerHTML = ''; return; }
  const branchIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><path d="M11 7.2V13a3 3 0 0 1-3 3H7.2"/><path d="M16 18h6M19 15v6"/></svg>`;
  const trashIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/></svg>`;
  let html = '';
  if (canAddChild(node)) html += `<button onclick="multiSelectAddChild()" title="이 노드 아래에 (제목 없음) 하위 노드를 추가합니다">${branchIcon} 하위 노드 추가</button>`;
  if (canDeleteNode(node)) html += `<button class="ms-danger" onclick="multiSelectDelete()" title="이 노드와 하위 노드를 삭제합니다 (노션 노드는 영구 삭제)">${trashIcon} 노드 삭제</button>`;
  if (!html) html = `<div style="padding:7px 14px;font-size:12px;color:rgba(255,255,255,0.4);white-space:nowrap;">편집할 수 없는 노드</div>`;
  menu.innerHTML = html;
  menu.classList.add('open');
  repositionMultiSelectMenu();
}

function repositionMultiSelectMenu() {
  if (_multiSelected.length < 1) return;
  const menu = document.getElementById('multi-select-menu');
  if (!menu || !menu.classList.contains('open')) return;
  const last = _multiSelected[_multiSelected.length - 1];
  const screenX = (last.x - W / 2) * scale + W / 2 + panX;
  const screenY = (last.y - H / 2) * scale + H / 2 + panY;
  menu.style.left = screenX + 'px';
  menu.style.top = (screenY + 20) + 'px';
}

function multiSelectStartConnect() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  _connectMode = true;
  _connectFirstNode = node; node.connectSelected = true;
  const s = document.getElementById('status');
  if (s) s.textContent = `"${node.label}" 기준 — 연결할 노드를 클릭하세요`;
  isStable = false;
}

function multiSelectFocus() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  _isolateActive = false; _pathConnectors = [];
  _focusMode = true;
  applyFocusMode(node.id);
  isStable = false;
  setTimeout(fitGraph, 50);
}

function multiSelectConnect() {
  if (_multiSelected.length !== 2) return;
  const [a, b] = _multiSelected;
  const existing = edges.find(e => e.manualLink && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)));
  if (existing) removeManualLink(a.id, b.id);
  else { edges.push({ from: a.id, to: b.id, manualLink: true }); saveManualLinks(); isStable = false; }
  clearMultiSelect();
}

function multiSelectChainConnect() {
  if (_multiSelected.length < 3) return;
  for (let i = 0; i < _multiSelected.length - 1; i++) {
    const a = _multiSelected[i], b = _multiSelected[i + 1];
    const existing = edges.find(e => e.manualLink && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)));
    if (!existing) edges.push({ from: a.id, to: b.id, manualLink: true });
  }
  saveManualLinks();
  isStable = false;
  clearMultiSelect();
}

function _bfsRealPath(startId, endId) {
  if (startId === endId) return [startId];
  const visited = new Set([startId]);
  const prev = {};
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === endId) break;
    edges.forEach(e => {
      let next = null;
      if (e.from === cur) next = e.to;
      else if (e.to === cur) next = e.from;
      if (next && !visited.has(next)) { visited.add(next); prev[next] = cur; queue.push(next); }
    });
  }
  if (!visited.has(endId)) return [];
  const path = [endId];
  let cur = endId;
  while (cur !== startId) { cur = prev[cur]; path.unshift(cur); }
  return path;
}

function _findRootId(id) {
  let cur = id;
  for (let i = 0; i < 30; i++) {
    const n = nodeMap[cur];
    if (!n) return null;
    if (n.level === 0) return cur;
    const pe = edges.find(e => e.to === cur && !e.weakLink && !e.manualLink);
    if (!pe) return cur;
    cur = pe.from;
  }
  return cur;
}

function _bfsPath(startId, endId) {
  const direct = _bfsRealPath(startId, endId);
  if (direct.length) return direct;
  const startRoot = _findRootId(startId), endRoot = _findRootId(endId);
  if (!startRoot || !endRoot || startRoot === endRoot) return [];
  const upPath = _bfsRealPath(startId, startRoot);
  const downPath = _bfsRealPath(endRoot, endId);
  if (!upPath.length || !downPath.length) return [];
  _pathConnectors.push({ from: startRoot, to: endRoot });
  return [...upPath, ...downPath];
}

function multiSelectPath() {
  if (_multiSelected.length < 1) return;
  const allPathIds = new Set();
  _pathConnectors = [];
  if (_multiSelected.length === 1) {
    const startId = _multiSelected[0].id, rootId = _findRootId(startId);
    if (rootId) _bfsRealPath(startId, rootId).forEach(id => allPathIds.add(id));
  } else {
    for (let i = 0; i < _multiSelected.length; i++) {
      for (let j = i + 1; j < _multiSelected.length; j++) {
        _bfsPath(_multiSelected[i].id, _multiSelected[j].id).forEach(id => allPathIds.add(id));
      }
    }
  }
  if (allPathIds.size === 0) { clearMultiSelect(); return; }
  _focusMode = false; _focusNodeId = null;
  _isolateActive = true;
  nodes.forEach(n => { n.dimmed = !allPathIds.has(n.id); });
  isStable = false;
  clearMultiSelect();
  setTimeout(fitGraph, 50);
}

// 위성 모드는 노드 고정/해제처럼 노드별로 독립 토글된다.
function recomputeSatelliteFlags() {
  nodes.forEach(n => { n._satellite = false; });
  nodes.forEach(root => {
    if (!root._satelliteRoot) return;
    const group = new Set([root.id]);
    const q = [root.id];
    while (q.length) {
      const id = q.shift();
      edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !group.has(e.to)) { group.add(e.to); q.push(e.to); } });
    }
    group.forEach(id => { if (nodeMap[id]) nodeMap[id]._satellite = true; });
  });
}

function activateSatellite(node) {
  if (node._satelliteRoot) return;
  node._satelliteRoot = true;
  // node + 하위 트리에 위성 플래그
  const group = new Set([node.id]);
  const q = [node.id];
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !group.has(e.to)) { group.add(e.to); q.push(e.to); } });
  }
  group.forEach(id => { if (nodeMap[id]) nodeMap[id]._satellite = true; });
  // node의 부모(계층) 엣지 제거 — 루트 id로 태그해 복원용 저장
  const parentEdges = edges.filter(e => e.to === node.id && !e.weakLink && !e.manualLink);
  parentEdges.forEach(e => { e._satRoot = node.id; _satelliteRemovedEdges.push(e); });
  edges = edges.filter(e => !parentEdges.includes(e));
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
}

function releaseSatellite(node) {
  // 이 루트가 분리했던 부모 엣지 복원
  _satelliteRemovedEdges.filter(e => e._satRoot === node.id).forEach(e => { delete e._satRoot; edges.push(e); });
  _satelliteRemovedEdges = _satelliteRemovedEdges.filter(e => e._satRoot !== node.id);
  node._satelliteRoot = false;
  recomputeSatelliteFlags();
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
}

function multiSelectSatellite() {
  if (_multiSelected.length < 1) return;
  if (!_satelliteRemovedEdges) _satelliteRemovedEdges = [];
  _multiSelected.forEach(node => {
    if (node._satelliteRoot) releaseSatellite(node);
    else activateSatellite(node);
  });
  isStable = false;
  clearMultiSelect();
}

function multiSelectPin() {
  if (_multiSelected.length < 1) return;
  const allFixed = _multiSelected.every(n => n.fixed);
  _multiSelected.forEach(n => { n.fixed = !allFixed; if (!n.fixed) { n.vx = 0; n.vy = 0; } unfreezeSubtree(n); });
  saveFixedPositions();
  isStable = false;
  clearMultiSelect();
}

function multiSelectAddChild() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  if (!canAddChild(node)) { alert('이 노드에는 하위 노드를 만들 수 없어요.\n(최하위(####)이거나 생성이 제한된 노드입니다)'); return; }
  createChildNode(node, '(제목 없음)').then(ids => { if (ids.length && nodeMap[ids[0]]) openPanel(nodeMap[ids[0]]); }).catch(err => alert('하위 노드 추가 실패: ' + (err.message || err)));
}

function multiSelectDelete() {
  if (_multiSelected.length < 1) return;
  const targets = _multiSelected.slice();
  clearMultiSelect();
  const deletable = targets.filter(canDeleteNode);
  if (!deletable.length) { alert('선택한 노드는 삭제할 수 없어요.\n(페이지·DB 노드는 목록의 ✕로 닫으세요)'); return; }
  const skipped = targets.length - deletable.length;
  const totalCount = deletable.reduce((s, n) => s + _subtreeIds(n.id).length, 0);
  const hasNotion = deletable.some(n => !n.local);
  const msg = `${deletable.length}개 노드(하위 포함 총 ${totalCount}개)를 삭제할까요?`
    + (skipped ? `\n(삭제 불가 ${skipped}개는 제외)` : '')
    + (hasNotion ? '\n(노션 헤딩은 영구 삭제됩니다)' : '');
  showConfirm('노드 삭제', msg, async () => { for (const n of deletable) { await deleteNodeSubtree(n); } });
}

// ── 사이드바 토글 ─────────────────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const collapsed = sidebar.classList.toggle('collapsed');
  if (btn) btn.classList.toggle('collapsed-visible', collapsed);
}

// ── 디테일 패널 (탭) ──────────────────────────────────────────────────

let _detailPanelCollapsed = false;

// 우측 패널: 1개(단일) 또는 2개(상하 분할)의 독립 패인.
// 각 패인은 자체 탭 목록(tabs)과 활성 탭(activeTabId)을 가진다.
const MAX_TABS = 3;
let _panes = [{ tabs: [], activeTabId: null }];
let _activePane = 0;
let _splitMode = false;
let _draggingTab = null;
let _activeNode = null; // 현재 패널에 열린(선택된) 노드 — '노드 편집' 섹션이 사용

// 탭을 다른 패인으로 이동
function moveTabToPane(fromIdx, nodeId, toIdx) {
  if (fromIdx === toIdx || !_panes[fromIdx] || !_panes[toIdx]) return;
  const from = _panes[fromIdx], to = _panes[toIdx];
  const t = from.tabs.find(x => x.nodeId === nodeId);
  if (!t) return;
  from.tabs = from.tabs.filter(x => x.nodeId !== nodeId);
  if (from.activeTabId === nodeId) from.activeTabId = from.tabs.length ? from.tabs[from.tabs.length - 1].nodeId : null;
  to.tabs = to.tabs.filter(x => x.nodeId !== nodeId);
  if (to.tabs.length >= MAX_TABS) to.tabs.shift();
  to.tabs.push(t);
  to.activeTabId = nodeId;
  _activePane = toIdx;
  if (!anyTabs()) { closePanel(); return; }
  renderPanes();
}

function anyTabs() { return _panes.some(p => p.tabs.length > 0); }
function getPaneEl(i) { return document.querySelector(`#detail-panes .detail-pane[data-pane="${i}"]`); }

function updateDetailReopenTab() {
  const btn = document.getElementById('detail-panel-sidebar-toggle');
  if (!btn) return;
  const visuallyOpen = detailPanel.classList.contains('open') && !detailPanel.classList.contains('panel-collapsed');
  btn.classList.toggle('visible', !visuallyOpen && anyTabs());
}

function toggleDetailPanel() {
  _detailPanelCollapsed = !_detailPanelCollapsed;
  detailPanel.classList.toggle('panel-collapsed', _detailPanelCollapsed);
  updateDetailReopenTab();
}

function reopenDetailPanel() {
  if (!anyTabs()) return;
  if (detailPanel.classList.contains('open')) { _detailPanelCollapsed = false; detailPanel.classList.remove('panel-collapsed'); }
  else { showPanel(); }
  updateDetailReopenTab();
}

const _paneCollapseIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;
const _paneSplitIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

// 패인 DOM 구조 전체를 _panes 상태에 맞춰 재생성한다(분할/복귀 시 호출).
function renderPanes() {
  const wrap = document.getElementById('detail-panes');
  if (!wrap) return;
  wrap.classList.toggle('split', _splitMode);
  wrap.innerHTML = '';
  _panes.forEach((pane, i) => {
    const el = document.createElement('div');
    el.className = 'detail-pane' + (_splitMode && i === _activePane ? ' pane-active' : '');
    el.dataset.pane = i;
    // 분할 모드의 하단 패인(i===1)은 분할/복귀 버튼만 둔다
    const onlySplit = _splitMode && i === 1;
    el.innerHTML =
      `<div class="detail-tabs-bar">` +
        `<div class="detail-tabs"></div>` +
        `<button class="pane-split-btn${_splitMode ? ' active' : ''}" title="패널 상하 분할 / 복귀">${_paneSplitIcon}</button>` +
        (onlySplit ? '' :
          `<button class="pane-collapse-btn" title="패널 접기">${_paneCollapseIcon}</button>` +
          `<button class="pane-close-btn" title="전체 닫기" style="color:#ed7000;">✕</button>`) +
      `</div>` +
      `<div class="detail-body">` +
        `<div class="detail-title-row"><div class="detail-title"></div></div>` +
        `<div class="detail-meta-row"><span class="detail-date"></span></div>` +
        `<div class="detail-divider"></div>` +
        `<div class="detail-content"></div>` +
      `</div>`;
    el.querySelector('.pane-split-btn').onclick = (e) => { e.stopPropagation(); toggleDetailSplit(); };
    const collapseBtn = el.querySelector('.pane-collapse-btn');
    if (collapseBtn) collapseBtn.onclick = (e) => { e.stopPropagation(); toggleDetailPanel(); };
    const closeBtn = el.querySelector('.pane-close-btn');
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closePanel(); };
    el.addEventListener('mousedown', () => setActivePane(i));
    // 탭 드래그&드롭: 다른 패인 위에 떨어뜨리면 그 패인으로 이동
    el.addEventListener('dragover', (e) => {
      if (!_draggingTab || _draggingTab.pane === i) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
    el.addEventListener('drop', (e) => {
      el.classList.remove('drag-over');
      if (!_draggingTab || _draggingTab.pane === i) return;
      e.preventDefault();
      moveTabToPane(_draggingTab.pane, _draggingTab.nodeId, i);
    });
    wrap.appendChild(el);
    renderPaneTabs(i);
    const active = pane.tabs.find(t => t.nodeId === pane.activeTabId) || pane.tabs[pane.tabs.length - 1];
    if (active) renderPaneContent(i, active.node);
  });
}

function setActivePane(i) {
  if (_activePane === i) return;
  _activePane = i;
  document.querySelectorAll('#detail-panes .detail-pane').forEach(el => {
    el.classList.toggle('pane-active', _splitMode && +el.dataset.pane === i);
  });
}

function toggleDetailSplit() {
  if (!_splitMode) {
    _panes.push({ tabs: [], activeTabId: null });
    _splitMode = true;
    _activePane = 1; // 새로 연 아래쪽 패널을 활성으로
  } else {
    // 활성 패인을 남기고 단일 패널로 복귀
    _panes = [_panes[_activePane]];
    _activePane = 0;
    _splitMode = false;
  }
  renderPanes();
  updateDetailReopenTab();
}

function renderPaneTabs(i) {
  const paneEl = getPaneEl(i);
  if (!paneEl) return;
  const tabsEl = paneEl.querySelector('.detail-tabs');
  const pane = _panes[i];
  tabsEl.innerHTML = '';
  [...pane.tabs].reverse().forEach(tab => {
    const el = document.createElement('div');
    el.className = 'detail-tab' + (tab.nodeId === pane.activeTabId ? ' active' : '');
    el.draggable = true;
    el.innerHTML = `<span class="tab-label">${escapeHtml(tab.label)}</span><span class="tab-close">✕</span>`;
    el.querySelector('.tab-label').onclick = () => { setActivePane(i); switchTab(i, tab.nodeId); };
    el.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeTab(i, tab.nodeId); };
    el.addEventListener('dragstart', (e) => {
      _draggingTab = { pane: i, nodeId: tab.nodeId };
      el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tab.nodeId); }
    });
    el.addEventListener('dragend', () => {
      _draggingTab = null;
      document.querySelectorAll('#detail-panes .detail-pane').forEach(p => p.classList.remove('drag-over'));
      el.classList.remove('dragging');
    });
    tabsEl.appendChild(el);
  });
}

function switchTab(i, nodeId) {
  const pane = _panes[i];
  pane.activeTabId = nodeId;
  const tab = pane.tabs.find(t => t.nodeId === nodeId);
  if (tab) { renderPaneContent(i, tab.node); _activeNode = tab.node; }
  renderPaneTabs(i);
}

function closeTab(i, nodeId) {
  const pane = _panes[i];
  const idx = pane.tabs.findIndex(t => t.nodeId === nodeId);
  pane.tabs = pane.tabs.filter(t => t.nodeId !== nodeId);
  if (pane.tabs.length === 0) {
    if (_splitMode) { renderPaneTabs(i); renderPaneContent(i, null); pane.activeTabId = null; if (!anyTabs()) closePanel(); }
    else closePanel();
  } else {
    const next = pane.tabs[Math.min(idx, pane.tabs.length - 1)];
    switchTab(i, next.nodeId);
  }
}

function mdTableToHtml(text) {
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const splitRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      let j = i + 2; const bodyRows = [];
      while (j < lines.length && isRow(lines[j])) { bodyRows.push(splitRow(lines[j])); j++; }
      let html = '<table class="md-table"><thead><tr>' + header.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
      bodyRows.forEach(r => { html += '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>'; });
      html += '</tbody></table>';
      out.push(html);
      i = j;
    } else { out.push(lines[i]); i++; }
  }
  return out.join('\n');
}

function renderPaneContent(i, n) {
  const paneEl = getPaneEl(i);
  if (!paneEl) return;
  const titleEl = paneEl.querySelector('.detail-title');
  const dateEl = paneEl.querySelector('.detail-date');
  const contentEl = paneEl.querySelector('.detail-content');
  const titleRow = paneEl.querySelector('.detail-title-row');
  if (!n) {
    if (titleEl) titleEl.textContent = '';
    if (dateEl) dateEl.style.display = 'none';
    if (contentEl) contentEl.innerHTML = '';
    const oldLink = titleRow && titleRow.querySelector('.detail-notion-link');
    if (oldLink) oldLink.style.display = 'none';
    return;
  }
  if (titleEl) titleEl.textContent = n.label;
  if (dateEl) {
    if (n.date) { dateEl.style.display = 'inline'; dateEl.textContent = n.date; }
    else { dateEl.style.display = 'none'; }
  }
  let notionLinkEl = titleRow.querySelector('.detail-notion-link');
  if (!notionLinkEl) {
    notionLinkEl = document.createElement('a');
    notionLinkEl.className = 'detail-notion-link'; notionLinkEl.target = '_blank';
    notionLinkEl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#fff;text-decoration:none;margin-left:8px;opacity:1;';
    notionLinkEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Notion에서 보기`;
    titleRow.appendChild(notionLinkEl);
  }
  // 노션에서 보기 — 블록 id가 있으면 그 블록(텍스트)으로 바로 이동 (로컬/MD 노드는 숨김)
  const isLocalLike = n.local || String(n.sourcePageId || '').startsWith('md_');
  const linkTarget = isLocalLike ? '' : (n.notionBlockId || n.entryNotionId || (n.sourcePageId || '').replace(/-/g, ''));
  if (linkTarget) { notionLinkEl.href = `https://notion.so/${linkTarget.replace(/-/g, '')}`; notionLinkEl.style.display = 'inline-flex'; }
  else { notionLinkEl.style.display = 'none'; }

  // 수정 버튼 — 제목(blockId) 또는 본문(bodyBlocks)을 편집할 수 있는 노드
  let editBtn = titleRow.querySelector('.detail-edit-btn');
  if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.className = 'detail-edit-btn';
    editBtn.title = '제목·본문 수정';
    editBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
    titleRow.appendChild(editBtn);
  }
  if (n.local || n.notionBlockId || (n.bodyBlocks && n.bodyBlocks.length)) { editBtn.style.display = 'inline-flex'; editBtn.onclick = () => beginNodeEdit(i, n); }
  else { editBtn.style.display = 'none'; }


  let rawDesc = escapeHtml(n.desc || '(내용 없음)').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
  if (searchKeyword && searchMatches.has(n.id)) {
    const re = new RegExp(`(${searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    rawDesc = rawDesc.replace(re, '<mark style="background:rgba(237,112,0,0.35);color:#ed7000;border-radius:3px;padding:0 2px;">$1</mark>');
  }
  if (contentEl) {
    contentEl.innerHTML = mdTableToHtml(rawDesc);
    if (searchKeyword && searchMatches.has(n.id)) {
      setTimeout(() => { const mark = contentEl.querySelector('mark'); if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
    }
  }

}

// ── 편집 서식: contenteditable WYSIWYG (볼드/취소선) ──────────────────
// 저장 시 마크다운(**·~~)으로 직렬화, 표시 시 HTML로 변환
function htmlFromMarkdown(t) {
  return escapeHtml(t || '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
}
function markdownFromHtml(el) {
  function walk(node) {
    let s = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') s += '\n';
        else if (tag === 'strong' || tag === 'b') s += '**' + walk(c) + '**';
        else if (tag === 'del' || tag === 's' || tag === 'strike') s += '~~' + walk(c) + '~~';
        else if (tag === 'div' || tag === 'p') s += (s && !s.endsWith('\n') ? '\n' : '') + walk(c);
        else if (tag === 'span') {
          const st = c.getAttribute('style') || '';
          let inner = walk(c);
          if (/text-decoration[^;]*line-through/.test(st)) inner = '~~' + inner + '~~';
          if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) inner = '**' + inner + '**';
          s += inner;
        } else s += walk(c);
      }
    });
    return s;
  }
  return walk(el).replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

let _fmtField = null;
function _getFmtToolbar() {
  let tb = document.getElementById('fmt-toolbar');
  if (!tb) {
    tb = document.createElement('div'); tb.id = 'fmt-toolbar';
    tb.innerHTML = `<button data-cmd="bold" title="볼드 (Ctrl+B)"><b>B</b></button><button data-cmd="strikeThrough" title="취소선 (Ctrl+U)"><s>S</s></button>`;
    tb.querySelectorAll('button').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault()); // 선택 유지
      b.addEventListener('click', e => { e.preventDefault(); applyFmt(b.dataset.cmd); });
    });
    document.body.appendChild(tb);
  }
  return tb;
}
function _hideFmtToolbar() { const tb = document.getElementById('fmt-toolbar'); if (tb) tb.style.display = 'none'; }
function _showFmtToolbar(x, y) {
  const tb = _getFmtToolbar();
  tb.style.display = 'flex';
  const w = 70;
  tb.style.left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)) + 'px';
  tb.style.top = Math.max(8, y - 42) + 'px';
}
function applyFmt(cmd) {
  if (!_fmtField) return;
  _fmtField.focus();
  try { document.execCommand(cmd, false, null); } catch (e) {}
}
// contenteditable 요소에 서식 단축키/툴바 연결
function attachFormatting(field) {
  field.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); _fmtField = field; applyFmt('bold'); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); _fmtField = field; applyFmt('strikeThrough'); }
  });
  const upd = (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && field.contains(sel.anchorNode)) {
      _fmtField = field;
      const r = field.getBoundingClientRect();
      _showFmtToolbar((e && e.clientX) || r.left + 24, (e && e.clientY) || r.top);
    } else if (_fmtField === field) _hideFmtToolbar();
  };
  field.addEventListener('mouseup', upd);
  field.addEventListener('keyup', e => { if (e.shiftKey || (e.key && e.key.startsWith('Arrow'))) upd(e); });
  field.addEventListener('blur', () => setTimeout(_hideFmtToolbar, 160));
}

// 제목 + 본문 인라인 수정 (contenteditable WYSIWYG). 로컬 노드는 노션 호출 없이 로컬 저장
function beginNodeEdit(paneIdx, node) {
  const paneEl = getPaneEl(paneIdx);
  if (!paneEl) return;
  const titleEl = paneEl.querySelector('.detail-title');
  const contentEl = paneEl.querySelector('.detail-content');
  const isLocal = !!node.local;
  const hasTitle = isLocal || !!node.notionBlockId;
  const hasBody = isLocal || !!(node.bodyBlocks && node.bodyBlocks.length);
  const canAdd = !isLocal && !!(node.notionBlockId && node.notionParentId);
  if (!hasTitle && !hasBody && !canAdd) return;
  if (!contentEl) return;

  let titleInput = null;
  if (hasTitle && titleEl) {
    titleEl.innerHTML = '';
    titleInput = document.createElement('input');
    titleInput.className = 'detail-title-input'; titleInput.value = node.label;
    titleEl.appendChild(titleInput);
  }

  const rows = [];
  contentEl.innerHTML = '';
  const list = document.createElement('div'); list.className = 'body-edit-list';
  contentEl.appendChild(list);
  const addRow = (text, blk) => {
    const ce = document.createElement('div');
    ce.className = 'body-edit-row'; ce.contentEditable = 'true';
    ce.innerHTML = htmlFromMarkdown(text);
    if (!blk) ce.dataset.placeholder = '본문 내용…';
    list.appendChild(ce);
    attachFormatting(ce);
    rows.push({ blk: blk || null, el: ce, orig: text || '', isNew: !blk });
    return ce;
  };
  if (isLocal) addRow(node.desc || '', { local: true });
  else if (hasBody) node.bodyBlocks.forEach(blk => addRow(blk.text, blk));

  // 노션 헤딩 노드: 수정 화면 안에서 본문 블록 추가
  if (canAdd) {
    const addBody = document.createElement('button');
    addBody.className = 'detail-add-body-btn'; addBody.textContent = '+ 본문 추가';
    addBody.onclick = () => { addRow('', null).focus(); };
    contentEl.appendChild(addBody);
  }

  const actions = document.createElement('div'); actions.className = 'detail-edit-actions';
  const saveBtn = document.createElement('button'); saveBtn.className = 'detail-edit-save'; saveBtn.textContent = '저장';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'detail-edit-cancel'; cancelBtn.textContent = '취소';
  actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
  contentEl.appendChild(actions);

  if (titleInput) { titleInput.focus(); titleInput.select(); }
  else if (rows[0]) rows[0].el.focus();

  const finish = () => renderPaneContent(paneIdx, node);
  cancelBtn.onclick = finish;
  if (titleInput) titleInput.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finish(); } });
  saveBtn.onclick = async () => {
    const newTitle = titleInput ? titleInput.value.trim() : null;
    const titleChanged = !!(titleInput && newTitle && newTitle !== node.label);
    const valOf = r => markdownFromHtml(r.el);
    const dirty = rows.filter(r => r.isNew ? valOf(r).trim() : valOf(r) !== r.orig);
    if (!titleChanged && !dirty.length) { finish(); return; }
    saveBtn.disabled = true; cancelBtn.disabled = true; saveBtn.textContent = '저장중…';
    try {
      if (titleChanged) {
        if (!isLocal) await notionUpdateBlock(node.notionBlockId, newTitle);
        node.label = newTitle;
        _panes.forEach((p, pi) => { let t = false; p.tabs.forEach(tb => { if (tb.nodeId === node.id) { tb.label = newTitle; t = true; } }); if (t) renderPaneTabs(pi); });
        if (!isLocal) updateCachedBlockText(node.notionBlockId, newTitle);
        if (isLocal && node.level === 0 && window._sidebarPageList) {
          const it = window._sidebarPageList.find(p => p.id === node.sourcePageId);
          if (it) { it.title = newTitle; refreshSidebarRender(); }
        }
      }
      if (isLocal) {
        node.desc = valOf(rows[0]);
        saveLocalPages();
      } else {
        for (const r of dirty) {
          const nt = valOf(r).trim();
          if (r.isNew) {
            const res = await notionAppendBlock(node.notionParentId, node.notionBlockId, nt, 'paragraph');
            node.desc = node.desc ? node.desc + '\n' + nt : nt;
            if (res && res.id) {
              node.bodyBlocks = node.bodyBlocks || [];
              node.bodyBlocks.push({ id: res.id, text: nt });
              insertCachedBodyBlock(node.notionBlockId, res.id, nt);
            }
          } else {
            await notionUpdateBlock(r.blk.id, nt);
            if (node.desc && r.orig) node.desc = node.desc.replace(r.orig, nt);
            updateCachedBodyBlock(r.blk.id, nt);
            r.blk.text = nt;
          }
        }
      }
      isStable = false;
      renderPaneContent(paneIdx, node);
    } catch (err) {
      saveBtn.disabled = false; cancelBtn.disabled = false; saveBtn.textContent = '저장';
      alert('수정 실패: ' + (err.message || err));
    }
  };
}

// 이 노드에 하위 노드를 만들 수 있는가 (####/제한 노드는 false)
function canAddChild(n) {
  if (!n) return false;
  if (n.local) return true;
  if (n.notionBlockId && n.notionParentId && (n.headingDepth || 1) <= 3) return true;
  if (n.entryNotionId) return true;
  if (!n.notionBlockId && !n.entryNotionId && n.level === 0 && n.sourcePageId && !String(n.sourcePageId).startsWith('md_')) return true;
  return false;
}

// 하위(또는 #) 노드 생성 — 로컬은 노션 호출 없이, 노션은 append. 생성된 노드 id 배열 반환
async function createChildNode(node, rawTitle) {
  const title = (rawTitle || '').trim().replace(/\n/g, ' ') || '(제목 없음)';
  if (node.local) {
    const newIds = _addEntryChildNodes(node, `# ${title}`);
    newIds.forEach(id => { const c = nodeMap[id]; if (c) { c.visible = true; c.local = true; c.headingDepth = (node.headingDepth || 1) + 1; } });
    saveLocalPages();
    nodes.forEach(nd => { nd._frozen = false; nd._frozenFrames = 0; });
    isStable = false;
    return [...newIds];
  }
  const isHeading = !!node.notionBlockId;
  const pageLikeId = node.entryNotionId || node.sourcePageId;
  const parentId = isHeading ? node.notionParentId : String(pageLikeId).replace(/-/g, '');
  const afterId = isHeading ? node.notionBlockId : null;
  const childDepth = isHeading ? (node.headingDepth || 1) + 1 : 1;
  const res = await notionAppendBlock(parentId, afterId, title, isHeading ? 'heading' : 'heading_1');
  if (!res || !res.id) return [];
  const snippet = `[BLOCK:${res.id}|${parentId}]\n# ${title}`;
  const newIds = _addEntryChildNodes(node, snippet);
  newIds.forEach(id => { const c = nodeMap[id]; if (c) { c.visible = true; c.headingDepth = childDepth; } });
  if (isHeading) insertCachedChildHeading(node.notionBlockId, res.id, parentId, title);
  else appendCachedPageHeading(parentId, res.id, title);
  nodes.forEach(nd => { nd._frozen = false; nd._frozenFrames = 0; });
  isStable = false;
  return [...newIds];
}

// "노드 편집" 섹션의 하위 노드 추가 — 현재 활성 노드에 (제목 없음) 자식 생성
async function addChildToActive() {
  const n = _activeNode;
  if (!n) { alert('먼저 노드를 클릭해 선택하세요.'); return; }
  if (!canAddChild(n)) { alert('이 노드에는 하위 노드를 만들 수 없어요.\n(최하위(####)이거나 생성이 제한된 노드입니다)'); return; }
  const btn = document.getElementById('add-child-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  try {
    const ids = await createChildNode(n, '(제목 없음)');
    if (ids.length && nodeMap[ids[0]]) openPanel(nodeMap[ids[0]]);
  } catch (err) {
    alert('하위 노드 추가 실패: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

// 그래프 설정 세부(슬라이더) 토글
function toggleGraphDetail() {
  const d = document.getElementById('gcfg-detail');
  const t = document.getElementById('gcfg-toggle');
  if (!d) return;
  const open = (d.style.display === 'none' || !d.style.display);
  d.style.display = open ? 'block' : 'none';
  if (t) t.classList.toggle('open', open);
}

// 페이지 목록 클릭 → 그 페이지 하위 트리만 활성(화면 맞춤), 나머지 비활성
function focusPage(pageId) {
  if (!pageId) return;
  _focusMode = false; _focusNodeId = null;
  _isolateActive = true; _pathConnectors = [];
  const norm = String(pageId).replace(/-/g, '');
  nodes.forEach(nd => { nd.dimmed = !(nd.visible && String(nd.sourcePageId || '').replace(/-/g, '') === norm); });
  isStable = false;
  setTimeout(fitGraph, 60);
  if (typeof highlightSidebarPage === 'function') highlightSidebarPage(pageId);
}

function isAncestorOf(potentialAncId, nodeId) {
  let cur = nodeId;
  for (let i = 0; i < 30; i++) {
    const pe = edges.find(e => e.to === cur && !e.weakLink && !e.manualLink);
    if (!pe) break;
    if (pe.from === potentialAncId) return true;
    cur = pe.from;
  }
  return false;
}

function showPanel() {
  if (!anyTabs()) return;
  _detailPanelCollapsed = false;
  detailPanel.classList.add('open'); detailPanel.classList.remove('panel-collapsed');
  statusEl.classList.add('panel-open');
  renderPanes();
  updateDetailReopenTab();
}

function openPanel(n) {
  _activeNode = n;
  const pane = _panes[_activePane] || _panes[0];
  const existing = pane.tabs.find(t => t.nodeId === n.id);
  if (existing) {
    pane.activeTabId = n.id;
    renderPaneContent(_activePane, n);
    renderPaneTabs(_activePane);
  } else {
    if (pane.tabs.length >= MAX_TABS) pane.tabs.shift();
    pane.tabs.push({ nodeId: n.id, label: n.label, node: n });
    pane.activeTabId = n.id;
    renderPaneContent(_activePane, n);
    renderPaneTabs(_activePane);
  }
  _detailPanelCollapsed = false;
  detailPanel.classList.add('open'); detailPanel.classList.remove('panel-collapsed');
  statusEl.classList.add('panel-open');
  updateDetailReopenTab();
  if (_focusMode) {
    const shallow = _focusNodeId !== null && !n.dimmed && !isAncestorOf(n.id, _focusNodeId);
    applyFocusMode(n.id, shallow);
  }
  if (n.level === 0) highlightSidebarPage(n.sourcePageId || null);
}

function closePanel() {
  _panes = [{ tabs: [], activeTabId: null }];
  _activePane = 0; _splitMode = false; _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  renderPanes();
  updateDetailReopenTab();
}

function hidePanel() {
  if (!detailPanel.classList.contains('open')) return;
  _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  updateDetailReopenTab();
}

// ── 검색 ──────────────────────────────────────────────────────────────

const _searchHistory = [];
const MAX_HISTORY = 8;

function renderSearchHistory() {
  const container = document.getElementById('search-history');
  if (!container) return;
  container.innerHTML = '';
  _searchHistory.forEach((kw, idx) => {
    const item = document.createElement('div');
    item.className = 'search-history-item';
    item.innerHTML = `<span>${escapeHtml(kw)}</span><button class="search-history-del" onclick="deleteHistory(${idx},event)">✕</button>`;
    item.addEventListener('click', () => { searchInput.value = kw; doSearch(kw); });
    container.appendChild(item);
  });
}

function addHistory(kw) {
  if (!kw || kw.length < 1) return;
  const idx = _searchHistory.indexOf(kw);
  if (idx !== -1) _searchHistory.splice(idx, 1);
  _searchHistory.unshift(kw);
  if (_searchHistory.length > MAX_HISTORY) _searchHistory.pop();
  renderSearchHistory();
}

function deleteHistory(idx, e) { e.stopPropagation(); _searchHistory.splice(idx, 1); renderSearchHistory(); }

function doSearch(kw) {
  searchKeyword = kw.trim().toLowerCase();
  searchMatches.clear();
  const resultEl = document.getElementById('search-result-count');
  if (searchKeyword) {
    const directMatches = new Set();
    nodes.forEach(n => {
      if (!n.visible) return;
      const lt = n.label.toLowerCase(), dt = n.desc.toLowerCase();
      if (lt.includes(searchKeyword) || dt.includes(searchKeyword)) directMatches.add(n.id);
    });
    function getAncestors(nodeId) {
      const ancestors = []; let cur = nodeId;
      for (let i = 0; i < 10; i++) { const parentEdge = edges.find(e => e.to === cur && !e.weakLink); if (!parentEdge) break; ancestors.push(parentEdge.from); cur = parentEdge.from; }
      return ancestors;
    }
    directMatches.forEach(id => { searchMatches.add(id); getAncestors(id).forEach(aid => searchMatches.add(aid)); });
    if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = `${directMatches.size}개 결과`; }
    clearBtn.style.display = 'block';
    if (directMatches.size > 0) { clearTimeout(_searchFitTimer); _searchFitTimer = setTimeout(fitGraph, 450); }
  } else {
    if (resultEl) resultEl.style.display = 'none';
    clearBtn.style.display = 'none';
  }
  isStable = false;
}
let _searchFitTimer = null;

searchInput.addEventListener('input', e => doSearch(e.target.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { doSearch(searchInput.value.trim()); } });
document.getElementById('search-btn').addEventListener('click', () => { doSearch(searchInput.value.trim()); });
clearBtn.addEventListener('click', () => { searchInput.value = ''; doSearch(''); });


// ── 캔버스 이벤트 ─────────────────────────────────────────────────────

let mouseDownNode = null, mouseDownTime = 0;

// ── 노드 삭제 (노드 선택 모드 메뉴에서 사용) ──────────────────────────
function _subtreeIds(rootId) {
  const ids = [rootId], q = [rootId];
  while (q.length) { const id = q.shift(); edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !ids.includes(e.to)) { ids.push(e.to); q.push(e.to); } }); }
  return ids;
}
function canDeleteNode(n) { return !!(n && (n.local || n.notionBlockId)); }
async function deleteNodeSubtree(node) {
  const ids = new Set(_subtreeIds(node.id));
  try {
    if (!node.local && node.notionBlockId) { await notionDeleteBlock(node.notionBlockId); removeCachedBlockSection(node.notionBlockId); }
  } catch (err) { alert('노션 삭제 실패: ' + (err.message || err)); return; }
  nodes = nodes.filter(nd => !ids.has(nd.id));
  edges = edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
  ids.forEach(id => { delete nodeMap[id]; });
  _panes.forEach(p => { p.tabs = p.tabs.filter(t => !ids.has(t.nodeId)); if (p.activeTabId && ids.has(p.activeTabId)) p.activeTabId = p.tabs.length ? p.tabs[p.tabs.length - 1].nodeId : null; });
  if (_activeNode && ids.has(_activeNode.id)) _activeNode = null;
  if (!anyTabs()) closePanel(); else renderPanes();
  if (node.local) {
    if (node.level === 0) {
      _addedPageIds.delete(node.sourcePageId);
      if (window._sidebarPageList) window._sidebarPageList = window._sidebarPageList.filter(p => p.id !== node.sourcePageId);
      refreshSidebarRender();
    }
    saveLocalPages();
  }
  isStable = false;
}
canvas.addEventListener('mousemove', e => {
  if (drag) {
    const w = screenToWorld(e.clientX, e.clientY); drag.x = w.x; drag.y = w.y;
    nodes.forEach(n => { if (n._frozen && dist(n, drag) < 200) { n._frozen = false; n._frozenFrames = 0; } });
    { const q = [drag.id], seen = new Set([drag.id]); while (q.length) { const id = q.shift(); edges.forEach(e => { if (e.from === id && !e.weakLink && !seen.has(e.to)) { seen.add(e.to); const c = nodeMap[e.to]; if (c) { if (c._frozen) { c._frozen = false; c._frozenFrames = 0; } q.push(e.to); } } }); } }
    return;
  }
  if (isPanning) { panX = panStartOffsetX + (e.clientX - panStartX); panY = panStartOffsetY + (e.clientY - panStartY); return; }
  const n = getNodeAt(e.clientX, e.clientY);
  hoveredNode = n;
  if (_editMode || _multiSelectMode) canvas.style.cursor = _modeCursor();
  else canvas.style.cursor = n ? 'pointer' : 'default';
  if (n && n.level > 0) {
    tooltip.textContent = n.label; tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY - 32) + 'px';
  } else { tooltip.style.display = 'none'; }
});

canvas.addEventListener('mousedown', e => {
  mouseDownTime = Date.now();
  const n = getNodeAt(e.clientX, e.clientY);
  mouseDownNode = n;
  if (n) { drag = n; isStable = false; }
  else { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; panStartOffsetX = panX; panStartOffsetY = panY; canvas.style.cursor = 'grab'; }
});

let _clickTimer = null;

canvas.addEventListener('mouseup', e => {
  const elapsed = Date.now() - mouseDownTime;
  const n = getNodeAt(e.clientX, e.clientY);
  if (elapsed < 150 && n && n === mouseDownNode && n.level > 0 && _connectMode) {
    handleConnectClick(n);
  } else if (elapsed < 150 && n && n === mouseDownNode && _editMode) {
    selectForEdit(n);
  } else if (elapsed < 150 && n && n === mouseDownNode && (e.shiftKey || _multiSelectMode)) {
    toggleMultiSelect(n);
  } else if (elapsed < 150 && n && n === mouseDownNode) {
    clearTimeout(_clickTimer); _clickTimer = setTimeout(() => openPanel(n), 220);
  } else if (elapsed < 150 && !n) {
    clearAllModes();
  }
  if (drag && drag.fixed) saveFixedPositions();
  drag = null; isPanning = false; applyModeCursor();
});

function clearAllModes() {
  if (_multiSelected.length) clearMultiSelect();
  if (_focusMode) { _focusMode = false; _focusNodeId = null; nodes.forEach(nd => { nd.dimmed = false; }); isStable = false; }
  if (_isolateActive) { _isolateActive = false; _pathConnectors = []; nodes.forEach(nd => { nd.dimmed = false; }); isStable = false; }
  if (_connectMode) {
    _connectMode = false;
    if (_connectFirstNode) { _connectFirstNode.connectSelected = false; _connectFirstNode = null; }
    nodes.forEach(nd => { nd.connectSelected = false; });
    const s = document.getElementById('status'); if (s) s.textContent = '';
    isStable = false;
  }
}

canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hoveredNode = null; drag = null; isPanning = false; });

function unfreezeSubtree(node) {
  node._frozen = false; node._frozenFrames = 0;
  const q = [node.id], seen = new Set([node.id]);
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !seen.has(e.to)) { seen.add(e.to); const c = nodeMap[e.to]; if (c) { c._frozen = false; c._frozenFrames = 0; } q.push(e.to); } });
  }
}

canvas.addEventListener('dblclick', e => {
  clearTimeout(_clickTimer);
  const n = getNodeAt(e.clientX, e.clientY);
  if (!n) return;
  n.fixed = !n.fixed;
  if (!n.fixed) { n.vx = 0; n.vy = 0; }
  unfreezeSubtree(n);
  saveFixedPositions(); isStable = false;
  const s = document.getElementById('status');
  if (s) { s.textContent = n.fixed ? `📌 "${n.label}" 고정됨` : `"${n.label}" 고정 해제`; clearTimeout(canvas._st); canvas._st = setTimeout(() => { s.textContent = ''; }, 1800); }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const w = screenToWorld(e.clientX, e.clientY);
  let closest = null, minDist = 12 / scale;
  edges.filter(e2 => e2.manualLink).forEach(e2 => {
    const na = nodeMap[e2.from], nb = nodeMap[e2.to];
    if (!na?.visible || !nb?.visible) return;
    const dx = nb.x - na.x, dy = nb.y - na.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const t = Math.max(0, Math.min(1, ((w.x - na.x) * dx + (w.y - na.y) * dy) / (len * len)));
    const px = na.x + t * dx - w.x, py = na.y + t * dy - w.y;
    const d = Math.sqrt(px * px + py * py);
    if (d < minDist) { minDist = d; closest = e2; }
  });
  if (closest) { if (confirm(`"${nodeMap[closest.from]?.label}" ↔ "${nodeMap[closest.to]?.label}" 연결을 삭제할까요?`)) { removeManualLink(closest.from, closest.to); } }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.06 : 0.94;
  const mx = e.clientX, my = e.clientY;
  const wx = (mx - W / 2 - panX) / scale, wy = (my - H / 2 - panY) / scale;
  scale = Math.max(0.15, Math.min(4, scale * factor));
  panX = mx - W / 2 - wx * scale; panY = my - H / 2 - wy * scale;
  statusEl.textContent = `확대: ${Math.round(scale * 100)}%`;
  clearTimeout(canvas._st); canvas._st = setTimeout(() => { statusEl.textContent = ''; }, 1200);
}, { passive: false });

// ── 터치 지원 (모바일 팬/탭 + 핀치 줌) ─────────────────────────────────

let _touchMode = null, _touchMoved = false, _touchStartX = 0, _touchStartY = 0;
let _pinchStartDist = 0, _pinchStartScale = 1;
let _lastTapTime = 0, _lastTapNode = null;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    mouseDownTime = Date.now();
    const n = getNodeAt(t.clientX, t.clientY);
    mouseDownNode = n;
    _touchStartX = t.clientX; _touchStartY = t.clientY; _touchMoved = false;
    _touchMode = 'single';
    if (n) { drag = n; isStable = false; }
    else { isPanning = true; panStartX = t.clientX; panStartY = t.clientY; panStartOffsetX = panX; panStartOffsetY = panY; }
  } else if (e.touches.length === 2) {
    drag = null; isPanning = false; _touchMode = 'pinch';
    const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchStartDist = Math.sqrt(dx*dx + dy*dy); _pinchStartScale = scale;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (_touchMode === 'pinch' && e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
    const pinchDist = Math.sqrt(dx*dx + dy*dy);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2, midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const wx = (midX - W / 2 - panX) / scale, wy = (midY - H / 2 - panY) / scale;
    scale = Math.max(0.15, Math.min(4, _pinchStartScale * (pinchDist / _pinchStartDist)));
    panX = midX - W / 2 - wx * scale; panY = midY - H / 2 - wy * scale;
    statusEl.textContent = `확대: ${Math.round(scale * 100)}%`;
    clearTimeout(canvas._st); canvas._st = setTimeout(() => { statusEl.textContent = ''; }, 1200);
  } else if (_touchMode === 'single' && e.touches.length === 1) {
    const t = e.touches[0];
    if (Math.abs(t.clientX - _touchStartX) > 4 || Math.abs(t.clientY - _touchStartY) > 4) _touchMoved = true;
    if (drag) {
      const w = screenToWorld(t.clientX, t.clientY); drag.x = w.x; drag.y = w.y;
      nodes.forEach(n => { if (n._frozen && dist(n, drag) < 200) { n._frozen = false; n._frozenFrames = 0; } });
    } else if (isPanning) {
      panX = panStartOffsetX + (t.clientX - panStartX); panY = panStartOffsetY + (t.clientY - panStartY);
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (_touchMode === 'single' && !_touchMoved) {
    const elapsed = Date.now() - mouseDownTime;
    const n = mouseDownNode;
    if (elapsed < 300 && n && _connectMode && n.level > 0) {
      handleConnectClick(n);
    } else if (elapsed < 300 && n && _editMode) {
      selectForEdit(n);
    } else if (elapsed < 300 && n && _multiSelectMode) {
      toggleMultiSelect(n);
    } else if (elapsed < 300 && n) {
      const now = Date.now();
      if (_lastTapNode === n && now - _lastTapTime < 350) {
        clearTimeout(_clickTimer);
        n.fixed = !n.fixed;
        if (!n.fixed) { n.vx = 0; n.vy = 0; }
        unfreezeSubtree(n);
        saveFixedPositions(); isStable = false;
        if (statusEl) { statusEl.textContent = n.fixed ? `📌 "${n.label}" 고정됨` : `"${n.label}" 고정 해제`; clearTimeout(canvas._st); canvas._st = setTimeout(() => { statusEl.textContent = ''; }, 1800); }
        _lastTapNode = null; _lastTapTime = 0;
      } else {
        clearTimeout(_clickTimer); _clickTimer = setTimeout(() => openPanel(n), 220);
        _lastTapNode = n; _lastTapTime = now;
      }
    } else if (elapsed < 300 && !n) {
      clearAllModes();
    }
  }
  if (drag && drag.fixed) saveFixedPositions();
  drag = null; isPanning = false; mouseDownNode = null; _touchMode = null;
}, { passive: true });

window.addEventListener('resize', () => {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
});

// ── 패널 너비 조절 (드래그) ───────────────────────────────────────────

(function restorePanelWidths() {
  const sw = localStorage.getItem('snlog_sidebar_w');
  const dw = localStorage.getItem('snlog_detail_w');
  if (sw) document.documentElement.style.setProperty('--sidebar-w', sw + 'px');
  if (dw) document.documentElement.style.setProperty('--detail-w', dw + 'px');
})();

(function setupPanelResize() {
  const sH = document.getElementById('sidebar-resize-handle');
  const dH = document.getElementById('detail-resize-handle');
  if (!sH || !dH) return;
  let active = null;
  function onMove(clientX) {
    if (active === 'sidebar') {
      const w = Math.max(260, Math.min(640, clientX));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    } else if (active === 'detail') {
      const w = Math.max(280, Math.min(720, window.innerWidth - clientX - 12));
      document.documentElement.style.setProperty('--detail-w', w + 'px');
    }
  }
  function start(which, e) {
    active = which; e.preventDefault();
    document.body.classList.add('resizing-panel');
    (which === 'sidebar' ? sH : dH).classList.add('dragging');
  }
  function end() {
    if (!active) return;
    const prop = active === 'sidebar' ? '--sidebar-w' : '--detail-w';
    const key = active === 'sidebar' ? 'snlog_sidebar_w' : 'snlog_detail_w';
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(prop));
    if (v) localStorage.setItem(key, v);
    document.body.classList.remove('resizing-panel');
    sH.classList.remove('dragging'); dH.classList.remove('dragging');
    active = null;
  }
  sH.addEventListener('mousedown', e => start('sidebar', e));
  dH.addEventListener('mousedown', e => start('detail', e));
  window.addEventListener('mousemove', e => { if (active) onMove(e.clientX); });
  window.addEventListener('mouseup', end);
  sH.addEventListener('touchstart', e => start('sidebar', e), { passive: false });
  dH.addEventListener('touchstart', e => start('detail', e), { passive: false });
  window.addEventListener('touchmove', e => { if (active) { onMove(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  window.addEventListener('touchend', end);
})();

// ── 언어 시스템 ────────────────────────────────────────────────────────

const LANG = {
  ko: {
    'pg-add':'페이지 추가','kw-search':'키워드 검색','graph-cfg':'그래프 설정',
    'lbl-title':'제목 표시','lbl-focus':'포커스 모드','lbl-connect':'연결 모드','lbl-multiselect':'노드 선택 모드','lbl-fit':'화면 맞춤',
    'lbl-export':'이미지 내보내기','lbl-fit-short':'화면 맞춤','lbl-export-short':'이미지 저장','lbl-settings':'설정','lbl-repulsion':'노드 반발력','lbl-tension':'링크 장력','lbl-gravity':'중력','lbl-node-size':'노드 크기','lbl-link-width':'링크 두께',
    'ph-add':'노션 링크 or .MD파일(폴더) 임포트','ph-search':'키워드를 입력해 주세요',
    'btn-sync-all':'전체 동기화','btn-close-all':'전체 닫기',
    's-lang':'언어 / Language','s-lang-label':'언어','s-lang-sub':'앱 UI 언어를 변경합니다',
    's-api':'API 토큰','sc-save':'저장','sc-placeholder-token':'새 토큰 입력...',
    's-imgsize':'이미지 저장 크기',
    's-shortcuts':'키보드 단축키','s-shortcuts-hint':'버튼 클릭 후 원하는 키 입력',
    'sc-lbl':'제목 표시','sc-lbl-sub':'제목 표시 / 그래프',
    'sc-focus':'포커스 모드','sc-focus-sub':'선택 노드만 표시',
    'sc-connect':'연결 모드','sc-connect-sub':'노드 수동 연결',
    'sc-multiselectmode':'노드 선택 모드','sc-multiselectmode-sub':'노드 클릭하여 액션 메뉴 열기',
    'sc-fit':'화면 맞춤','sc-fit-sub':'전체 화면 맞춤',
    'sc-hide':'패널 숨기기','sc-hide-sub':'Esc (고정)',
    'sc-pin':'노드 고정 / 해제','sc-pin-sub':'더블클릭으로 고정','sc-dblclick':'더블클릭',
    'sc-multiselect':'노드 다중 선택','sc-multiselect-sub':'연결 / 경로찾기 / 위성 / 고정','sc-shiftclick':'Shift+클릭',
    's-local-warn':'⚠ API 토큰이 이 기기의 브라우저에 저장됩니다. 공용 컴퓨터에서는 사용을 권장하지 않습니다.',
    's-storage':'저장 & 캐시 세부조정','s-local':'로컬 저장 사용','s-local-sub':'브라우저를 닫아도 데이터가 유지됩니다',
    's-page-cache':'페이지 캐시','s-page-cache-sub':'불러온 노션 페이지 내용',
    's-connect-cache':'연결 모드 캐시','s-connect-cache-sub':'수동 연결 엣지',
    's-all-cache':'전체 캐시','s-del':'삭제','s-del-all':'전체 삭제','s-close-btn':'닫기',
  },
  en: {
    'pg-add':'Add Page','kw-search':'Search','graph-cfg':'Graph Settings',
    'lbl-title':'Title Mark','lbl-focus':'Focus Mode','lbl-connect':'Connect Mode','lbl-multiselect':'Node Select Mode','lbl-fit':'Fit to View',
    'lbl-export':'Export PNG','lbl-fit-short':'Fit','lbl-export-short':'Export','lbl-settings':'Settings','lbl-repulsion':'Repulsion','lbl-tension':'Link Tension','lbl-gravity':'Gravity','lbl-node-size':'Node Size','lbl-link-width':'Link Width',
    'ph-add':'Notion link or .MD file/folder import','ph-search':'Enter a keyword...',
    'btn-sync-all':'Sync All','btn-close-all':'Close All',
    's-lang':'Language','s-lang-label':'Language','s-lang-sub':'Change app UI language',
    's-api':'API Token','sc-save':'Save','sc-placeholder-token':'Enter new token...',
    's-imgsize':'Export Image Size',
    's-shortcuts':'Keyboard Shortcuts','s-shortcuts-hint':'Click a button, then press a key',
    'sc-lbl':'Toggle Labels','sc-lbl-sub':'Show/hide node labels',
    'sc-focus':'Focus Mode','sc-focus-sub':'Show selected node only',
    'sc-connect':'Connect Mode','sc-connect-sub':'Connect nodes manually',
    'sc-multiselectmode':'Node Select Mode','sc-multiselectmode-sub':'Click nodes to open action menu',
    'sc-fit':'Fit to View','sc-fit-sub':'Fit graph to screen',
    'sc-hide':'Hide Panel','sc-hide-sub':'Esc (fixed)',
    'sc-pin':'Pin / Unpin Node','sc-pin-sub':'Double-click to pin','sc-dblclick':'Double-click',
    'sc-multiselect':'Multi-Select Nodes','sc-multiselect-sub':'Connect / Path / Satellite / Pin','sc-shiftclick':'Shift+Click',
    's-local-warn':'⚠ API token is stored in this browser. Not recommended on shared computers.',
    's-storage':'Storage & Cache Details','s-local':'Use Local Storage','s-local-sub':'Data persists after browser is closed',
    's-page-cache':'Page Cache','s-page-cache-sub':'Loaded Notion page content',
    's-connect-cache':'Connect Cache','s-connect-cache-sub':'Manual edge connections',
    's-all-cache':'All Cache','s-del':'Delete','s-del-all':'Delete All','s-close-btn':'Close',
  }
};

let _lang = localStorage.getItem('snlog_lang') || 'ko';
function t(key) { return (LANG[_lang] || LANG.ko)[key] || (LANG.ko[key] || key); }
function setLang(lang) { _lang = lang; localStorage.setItem('snlog_lang', lang); applyLang(); }
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const v = t(el.dataset.i18nPh); if (v) el.placeholder = v; });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const v = t(el.dataset.i18nTitle); if (v) el.title = v; });
  ['ko','en'].forEach(l => { document.getElementById('lang-btn-' + l)?.classList.toggle('active', _lang === l); });
}
function toggleSection(id) {
  const body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
  localStorage.setItem('snlog_sec_' + id, isOpen ? '0' : '1');
}

// ── 단축키 시스템 ─────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = { toggleEditMode: '1', toggleMultiSelectMode: '2', fitGraph: ' ' };
let _shortcuts = (() => { try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('snlog_shortcuts') || '{}') }; } catch(e) { return { ...DEFAULT_SHORTCUTS }; } })();
// 구버전 단축키 정리 (포커스/연결/제목표시 제거, 노드선택 모드 4→2 이전)
delete _shortcuts.toggleFocusMode; delete _shortcuts.toggleConnectMode; delete _shortcuts.toggleLabels;
if (!_shortcuts.toggleEditMode) _shortcuts.toggleEditMode = '1';
if (_shortcuts.toggleMultiSelectMode === '4' || _shortcuts.toggleMultiSelectMode === '3') _shortcuts.toggleMultiSelectMode = '2';
function saveShortcuts() { localStorage.setItem('snlog_shortcuts', JSON.stringify(_shortcuts)); }
function formatKey(k) { return k === ' ' ? 'Space' : k.toUpperCase(); }
function updateShortcutHints() {
  ['toggleEditMode','toggleMultiSelectMode','fitGraph'].forEach(action => {
    const el = document.getElementById('hint-' + action);
    if (el) el.textContent = `(${formatKey(_shortcuts[action])})`;
  });
}

let _recordingFor = null, _recordingBtn = null;
function recordShortcut(action, btn) {
  if (_recordingFor) { _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); }
  _recordingFor = action; _recordingBtn = btn;
  btn.classList.add('recording'); btn.textContent = '...';
}

document.addEventListener('keydown', e => {
  if (_recordingFor) {
    e.preventDefault();
    if (e.key === 'Escape') { _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); _recordingFor = null; _recordingBtn = null; return; }
    const k = e.key;
    if (k.length === 1) { _shortcuts[_recordingFor] = k; saveShortcuts(); updateShortcutHints(); _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(k); _recordingFor = null; _recordingBtn = null; }
    return;
  }
  if (e.key === 'Escape') {
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (detailPanel.classList.contains('open')) { hidePanel(); return; }
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) { toggleSidebar(); return; }
    if (sidebar && sidebar.classList.contains('collapsed')) { toggleSidebar(); if (anyTabs()) showPanel(); return; }
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === _shortcuts.toggleEditMode) { e.preventDefault(); document.getElementById('editmode-toggle-input')?.click(); }
  else if (k === _shortcuts.toggleMultiSelectMode) { e.preventDefault(); document.getElementById('multiselect-toggle-input')?.click(); }
  else if (k === _shortcuts.fitGraph) { e.preventDefault(); fitGraph(); }
});

// ── 프로필 ────────────────────────────────────────────────────────────

let _profile = {};

async function loadProfile() {
  if (!_savedToken) return;
  try { _profile = await notionFetch({ action: 'profile' }); renderProfile(); } catch(e) {}
}

function renderProfile() {
  const profileEl = document.getElementById('sidebar-profile');
  if (profileEl) profileEl.style.display = 'flex';
  const initial = (_profile.name || '?')[0].toUpperCase();
  const initEl = document.getElementById('profile-initial');
  const avatarEl = document.getElementById('profile-avatar');
  if (_profile.avatar) {
    avatarEl.innerHTML = `<img src="${_profile.avatar}" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`;
  } else if (initEl) { initEl.textContent = initial; }
  const nameEl = document.getElementById('profile-name'), wsEl = document.getElementById('profile-workspace');
  if (nameEl) nameEl.textContent = _profile.name || '—';
  if (wsEl) wsEl.textContent = _profile.workspace || '';
}

// ── 설정 모달 ─────────────────────────────────────────────────────────

function openSettings() {
  const initial = (_profile.name || '?')[0].toUpperCase();
  const sAvatar = document.getElementById('settings-avatar'), sInitial = document.getElementById('settings-initial');
  if (_profile.avatar) { sAvatar.innerHTML = `<img src="${_profile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`; }
  else if (sInitial) { sInitial.textContent = initial; }
  const sName = document.getElementById('settings-name'), sEmail = document.getElementById('settings-email'), sWs = document.getElementById('settings-workspace');
  if (sName) sName.textContent = _profile.name || '—';
  if (sEmail) sEmail.textContent = _profile.email || '—';
  if (sWs) sWs.textContent = _profile.workspace || '—';

  const localToggle = document.getElementById('s-local-toggle');
  if (localToggle) localToggle.checked = _useLocalStorage;
  const warn = document.getElementById('s-local-warn');
  if (warn) warn.style.display = _useLocalStorage ? 'block' : 'none';

  ['pages','connect'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) el.checked = _storageScopes[k] !== false; });
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', _exportSize === s); });
  ['toggleEditMode','toggleMultiSelectMode','fitGraph'].forEach(action => { const btn = document.getElementById('sc-' + action); if (btn) btn.textContent = formatKey(_shortcuts[action]); });
  ['ko','en'].forEach(l => { document.getElementById('lang-btn-' + l)?.classList.toggle('active', _lang === l); });

  ['shortcuts','storage'].forEach(id => {
    const saved = localStorage.getItem('snlog_sec_' + id), body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
    if (!body) return;
    const isOpen = saved === '1';
    body.style.display = isOpen ? '' : 'none';
    if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
  });

  document.getElementById('settings-modal').classList.add('open');
}

function closeSettings() {
  if (_recordingFor) { _recordingBtn?.classList.remove('recording'); if (_recordingBtn) _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); _recordingFor = null; _recordingBtn = null; }
  document.getElementById('settings-modal').classList.remove('open');
  ['pages','connect'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) _storageScopes[k] = el.checked; });
  localStorage.setItem('snlog_scopes', JSON.stringify(_storageScopes));
}

function onStorageToggle(el) {
  _useLocalStorage = el.checked;
  localStorage.setItem('snlog_use_local', _useLocalStorage);
  const warn = document.getElementById('s-local-warn');
  if (warn) warn.style.display = _useLocalStorage ? 'block' : 'none';
  if (_useLocalStorage) { if (_savedToken) localStorage.setItem('snlog_token', _savedToken); }
  else { Object.keys(localStorage).filter(k => k.startsWith('snlog_') && k !== 'snlog_use_local').forEach(k => localStorage.removeItem(k)); }
}

function updateToken() {
  const input = document.getElementById('settings-token-input'), msg = document.getElementById('settings-token-msg');
  const val = input?.value.trim();
  if (!val) { if (msg) { msg.textContent = '토큰을 입력해주세요'; msg.style.display = 'block'; } return; }
  if (!val.startsWith('secret_') && !val.startsWith('ntn_')) { if (msg) { msg.textContent = '올바른 형식이 아닙니다 (secret_ 또는 ntn_)'; msg.style.display = 'block'; } return; }
  _savedToken = val;
  sessionStorage.setItem('snlog_token', val);
  if (_useLocalStorage) localStorage.setItem('snlog_token', val);
  if (input) input.value = '';
  if (msg) { msg.textContent = '저장됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  loadProfile();
}

function setExportSize(size) {
  _exportSize = size;
  localStorage.setItem('snlog_export_size', size);
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', s === size); });
}

function clearCache(type) {
  const allKeys = [...Object.keys(sessionStorage), ...Object.keys(localStorage)];
  if (type === 'pages' || type === 'all') {
    allKeys.filter(k => k.startsWith('snlog_') && !['snlog_token','snlog_pages','snlog_manual_links','snlog_use_local','snlog_scopes','snlog_export_size','snlog_slider','snlog_search_history'].includes(k))
      .forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); });
    sessionStorage.removeItem('snlog_pages'); localStorage.removeItem('snlog_pages');
  }
  if (type === 'slider' || type === 'all') { sessionStorage.removeItem('snlog_slider'); localStorage.removeItem('snlog_slider'); }
  if (type === 'connect' || type === 'all') { sessionStorage.removeItem('snlog_manual_links'); localStorage.removeItem('snlog_manual_links'); }
  if (type === 'search' || type === 'all') { sessionStorage.removeItem('snlog_search_history'); localStorage.removeItem('snlog_search_history'); }
  const msg = document.getElementById('settings-token-msg');
  if (msg) { msg.textContent = '삭제됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 1500); }
}

document.getElementById('settings-modal')?.addEventListener('click', function(e) { if (e.target === this) closeSettings(); });

// ── 슬라이더 복원 ─────────────────────────────────────────────────────

function restoreSlider() {
  const saved = snGet('snlog_slider', 'slider');
  if (!saved) return;
  try { const { rep, grav, tension, nodeSize, linkWidth } = JSON.parse(saved); if (rep) cfgRep.value = rep; if (grav) cfgGrav.value = grav; if (tension) cfgTension.value = tension; if (nodeSize) cfgNodeSize.value = nodeSize; if (linkWidth) cfgLinkWidth.value = linkWidth; updateConfig(); } catch(e) {}
}

// ── 검색 기록 저장/복원 ───────────────────────────────────────────────

function saveSearchHistory() { snSet('snlog_search_history', JSON.stringify(_searchHistory), 'search'); }
function restoreSearchHistory() {
  const saved = snGet('snlog_search_history', 'search');
  if (!saved) return;
  try { const arr = JSON.parse(saved); arr.forEach(kw => { if (!_searchHistory.includes(kw)) _searchHistory.push(kw); }); renderSearchHistory(); } catch(e) {}
}

// ── 메인 루프 & 초기화 ────────────────────────────────────────────────

updateConfig();
applyLang();
updateShortcutHints();
renderPanes();

function loop() { simulate(); draw(); repositionMultiSelectMenu(); requestAnimationFrame(loop); }

if (_savedToken || sessionStorage.getItem('snlog_pages') || localStorage.getItem('snlog_local_pages')) {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input-token');
    if (input) input.value = _savedToken;
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    buildGraph();
    loop();
    loadFolderBatches();
    loadMdFileHandles();
    setTimeout(restoreLocalPages, 300);
    setTimeout(restorePageList, 500);
    setTimeout(loadManualLinks, 2000);
    setTimeout(initSidebarPageList, 600);
    setTimeout(loadProfile, 400);
    setTimeout(restoreSlider, 200);
  });
}
