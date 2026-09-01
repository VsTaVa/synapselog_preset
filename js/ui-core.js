// ── 스토리지 시스템 ──────────────────────────────────────────────────

let _useLocalStorage = localStorage.getItem('snlog_use_local') === 'true';
let _storageScopes = (() => { try { return JSON.parse(localStorage.getItem('snlog_scopes') || '{}'); } catch(e) { return {}; } })();
['pages','slider','connect'].forEach(k => { if (_storageScopes[k] === undefined) _storageScopes[k] = true; });
let _exportSize = parseInt(localStorage.getItem('snlog_export_size') || '2048');
let _savedAiKey = _decKey(sessionStorage.getItem('snlog_ai_key')) || _decKey(localStorage.getItem('snlog_ai_key')) || '';

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

let _favoritePageIds = new Set((() => { try { return JSON.parse(snGet('snlog_favorites', 'pages') || '[]'); } catch(e) { return []; } })());
function toggleFavorite(pageId) {
  if (_favoritePageIds.has(pageId)) _favoritePageIds.delete(pageId); else _favoritePageIds.add(pageId);
  snSet('snlog_favorites', JSON.stringify([..._favoritePageIds]), 'pages');
  refreshSidebarRender();
}

// ── 노드 북마크 (켜면 제목이 주황색) ─────────────────────────────
// 안정 키로 저장: 노션 노드는 notionBlockId, 그 외는 노드 id
let _bookmarkedKeys = new Set((() => { try { return JSON.parse(localStorage.getItem('snlog_bookmarks') || '[]'); } catch(e) { return []; } })());
function bookmarkKey(n) { return n && (n.notionBlockId || n.id); }
function isBookmarked(n) { return !!n && _bookmarkedKeys.has(bookmarkKey(n)); }
function saveBookmarks() { try { localStorage.setItem('snlog_bookmarks', JSON.stringify([..._bookmarkedKeys])); } catch(e) {} if (typeof _activeRailSection !== 'undefined' && _activeRailSection === 'bookmarks' && typeof renderBookmarkList === 'function') renderBookmarkList(); }
function toggleBookmark(n) {
  if (!n) return;
  const k = bookmarkKey(n);
  if (_bookmarkedKeys.has(k)) _bookmarkedKeys.delete(k); else _bookmarkedKeys.add(k);
  saveBookmarks();
  isStable = false;
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
const cfgHub = document.getElementById('cfg-hub');
const vRep = document.getElementById('v-rep');
const vGrav = document.getElementById('v-grav');
const vTension = document.getElementById('v-tension');
const vNodeSize = document.getElementById('v-node-size');
const vLinkWidth = document.getElementById('v-link-width');
const vHub = document.getElementById('v-hub');
const detailPanel = document.getElementById('detail-panel');

// ── 그래프 설정 슬라이더 ──────────────────────────────────────────────

function updateConfig() {
  CONFIG.repulsion = parseFloat(cfgRep.value);
  CONFIG.gravity = parseFloat(cfgGrav.value);
  CONFIG.linkTension = parseFloat(cfgTension.value);
  CONFIG.nodeSize = parseFloat(cfgNodeSize.value);
  CONFIG.linkWidth = parseFloat(cfgLinkWidth.value) * 1.5; // 표시값 1.0 = 실제 두께 1.5
  CONFIG.hubGlow = parseFloat(cfgHub.value);
  vRep.textContent = Math.round(parseFloat(cfgRep.value) / 100);
  vGrav.textContent = Math.round(parseFloat(cfgGrav.value) * 10000);
  vTension.textContent = Math.round(parseFloat(cfgTension.value) * 1000);
  vNodeSize.textContent = parseFloat(cfgNodeSize.value).toFixed(1);
  vLinkWidth.textContent = parseFloat(cfgLinkWidth.value).toFixed(1);
  vHub.textContent = parseFloat(cfgHub.value).toFixed(1);
  isStable = false;
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
  // 방사형만 물리를 안 쓰므로 좌표 재계산. (클러스터는 물리라 슬라이더가 매 프레임 반영됨)
  if (_layoutMode === 'radial') applyTreeLayout();
  // 그래프 슬라이더는 레이아웃·색상·라벨스케일처럼 항상 localStorage에 저장(민감정보 아님, 토글/스코프 무관)
  try { localStorage.setItem('snlog_slider', JSON.stringify({ rep: cfgRep.value, grav: cfgGrav.value, tension: cfgTension.value, nodeSize: cfgNodeSize.value, linkWidth: cfgLinkWidth.value, hub: cfgHub.value })); } catch (e) {}
}
cfgRep.addEventListener('input', updateConfig);
cfgGrav.addEventListener('input', updateConfig);
cfgTension.addEventListener('input', updateConfig);
cfgNodeSize.addEventListener('input', updateConfig);
cfgLinkWidth.addEventListener('input', updateConfig);
cfgHub.addEventListener('input', updateConfig);

// ── 로딩 오버레이 ─────────────────────────────────────────────────────

function showLoading(text='불러오는 중...') {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (el) el.classList.add('visible');
  if (txt) txt.textContent = text;
}
function hideLoading() { const el = document.getElementById('loading-overlay'); if (el) el.classList.remove('visible'); }

// 버튼 아래에 뜨는 작은 메뉴 — 같은 버튼을 다시 누르면 닫히고 null을 준다.
// 여는 쪽마다 바깥 클릭·리사이즈 정리를 다시 적으면 하나만 빠뜨려도 메뉴가 화면에 남는다
function openMenuNear(anchor, id, className, html) {
  const old = document.getElementById(id);
  if (old) { const same = old._anchor === anchor; old._close(); if (same) return null; }
  const menu = document.createElement('div');
  menu.id = id; menu.className = className; menu.innerHTML = html;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(), mw = 168;
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
  const close = () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('resize', close); menu.remove(); };
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  menu._anchor = anchor; menu._close = close;
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  window.addEventListener('resize', close);
  return menu;
}

// ── 제목 크기 ─────────────────────────────────────────────────────────

// 0(숨김)에서 돌아올 크기 — 숨긴 채 새로고침해도 원래 크기로 돌아오게 따로 저장한다
let _labelScalePrev = (() => { try { const v = parseFloat(localStorage.getItem('snlog_label_scale_prev')); return (v > 0 && v <= 2.5) ? v : 1; } catch(e) { return 1; } })();

// 단축키(T): 제목 크기를 0과 직전 값 사이로 오간다
// 표시 깊이 — 오른쪽 끝이 전체, 왼쪽으로 갈수록 깊은 단계부터 접힌다
function setDepthLimit(v) {
  const n = parseInt(v);
  applyDepthLimit(n);
  const out = document.getElementById('v-depth');
  if (out) out.textContent = (n >= DEPTH_ALL) ? '전체' : String(n);
  showViewStatus(); // 몇 개가 접혔는지 바로 보이게
}
function toggleLabels() {
  setLabelScale(_labelScale > 0 ? 0 : _labelScalePrev);
  const sl = document.getElementById('cfg-label-scale');
  if (sl) sl.value = _labelScale;
}

function setLabelScale(v) {
  v = parseFloat(v); if (!(v >= 0 && v <= 2.5)) v = 1;
  if (v > 0) { _labelScalePrev = v; try { localStorage.setItem('snlog_label_scale_prev', String(v)); } catch (e) {} }
  _labelScale = v;
  try { localStorage.setItem('snlog_label_scale', String(v)); } catch (e) {}
  const out = document.getElementById('label-scale-val');
  if (out) out.textContent = Math.round(v * 100) + '%';
  isStable = false;
}

function setViewRotation(deg) {
  deg = ((parseFloat(deg) || 0) % 360 + 360) % 360;
  const newRot = deg * Math.PI / 180;
  // 회전축: 페이지별(cluster) 배치는 밀도에 안 쏠리는 기하학적 중심(링 정중앙),
  // 그 외에는 보이는 노드 무게중심. 회전 전 화면상 위치를 유지하도록 팬 보정
  const c = (_clusterMode ? visibleBBoxCenter() : visibleCentroid()); // 나눠 놓으면 무게중심이 빈 가운데로 쏠린다
  if (c) {
    const sb = worldToScreen(c.x, c.y); // 회전 전 무게중심의 화면 위치
    _viewRotation = newRot;
    const dx = c.x - W/2, dy = c.y - H/2;
    const rc = Math.cos(newRot), rs = Math.sin(newRot);
    panX = sb.x - W/2 - (dx*rc - dy*rs) * scale;
    panY = sb.y - H/2 - (dx*rs + dy*rc) * scale;
  } else {
    _viewRotation = newRot; // 노드 없으면 중력중심(W/2,H/2) 기준
  }
  try { localStorage.setItem('snlog_rotation', String(_viewRotation)); } catch (e) {}
  showViewStatus();
}
// 하단 중앙 상태바 = 진행 안내(연결 모드) + 잠깐 뜨는 크기·회전.
// 각각의 span에 나눠 담는다 — 한 덩어리로 쓰면 크기 표시가 사라질 때 안내까지 지워진다
function _statusSpan(cls) {
  if (!statusEl) return null;
  let el = statusEl.querySelector('.' + cls);
  if (!el) { el = document.createElement('span'); el.className = cls; statusEl.appendChild(el); }
  return el;
}
// 둘 다 비면 빈 상자만 떠 있게 되므로 표시 자체를 끈다
function _syncStatusBox() {
  if (!statusEl) return;
  const el = c => statusEl.querySelector('.' + c);
  const txt = c => (el(c) || {}).textContent;
  // 크기·회전(과 진행 안내)이 우선 — 경로와 겹치면 상자가 두 배로 커지고 읽을 것도 늘어난다
  const busy = !!(txt('st-view') || txt('st-hint'));
  const path = el('st-path');
  if (path) path.style.display = busy ? 'none' : 'flex';
  const has = busy || (path && path.childElementCount);
  statusEl.style.display = has ? 'flex' : 'none';
}
// 연결 모드 같은 진행 안내 — 칩·확대 표시와 같은 상자에 나란히
function setStatusHint(t) {
  const el = _statusSpan('st-hint');
  if (!el) return;
  el.textContent = t || '';
  _syncStatusBox();
}
// 노드·연결 수 — 표시 깊이로 감춘 게 있으면 보이는 수/전체로 적는다
function _graphCountText() {
  if (typeof nodes === 'undefined' || !nodes.length) return '';
  const vis = nodes.filter(n => n.visible).length;
  const link = edges.filter(e => nodeMap[e.from] && nodeMap[e.to] && nodeMap[e.from].visible && nodeMap[e.to].visible).length;
  return `노드 ${vis < nodes.length ? vis + '/' + nodes.length : vis}    ·   연결 ${link}`;
}
// 담은 페이지가 없으면 캔버스 위에 안내를 띄운다 — 레일이 접혀 있으면 사이드바 안내가 안 보인다
function syncEmptyHint() {
  const el = document.getElementById('graph-empty');
  if (!el) return;
  const empty = typeof nodes === 'undefined' || !nodes.some(n => n.visible);
  if (el._on === empty) return;
  el._on = empty; el.style.display = empty ? 'flex' : 'none';
}
function showViewStatus() {
  const el = _statusSpan('st-view');
  if (!el) return;
  const pct = Math.round(scale * 100);
  const deg = Math.round(((_viewRotation * 180 / Math.PI) % 360 + 360) % 360);
  const cnt = _graphCountText();
  el.textContent = `크기 ${pct}%` + (deg ? `    ·   회전 ${deg}°` : '') + (cnt ? `    ·   ${cnt}` : '');
  _syncStatusBox();
  clearTimeout(canvas._st); canvas._st = setTimeout(() => { el.textContent = ''; _syncStatusBox(); }, 1400);
}
// 호버한 노드가 어디에 속하는지 — 패널의 위치 경로와 같은 함수로 그린다(칩 모양이 갈라지지 않게)
let _statusPathId = null, _statusPathLeftAt = 0;
const STATUS_PATH_LINGER = 500; // 노드 사이를 지나갈 때마다 사라졌다 나타나면 깜빡여 보인다
function updateStatusPath() {
  const el = _statusSpan('st-path');
  if (!el) return;
  // 터치엔 호버가 없다 — 끌고 있는 노드, 그것도 없으면 지금 패널에 열린 노드를 기준으로
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const n = (typeof hoveredNode !== 'undefined' && hoveredNode)
    || (typeof drag !== 'undefined' && drag)
    || (coarse && typeof _activeNode !== 'undefined' ? _activeNode : null)
    || null;
  if (n) {
    _statusPathLeftAt = 0;
    if (n.id === _statusPathId) return;
    _statusPathId = n.id;
    const path = (typeof _nodePathHtml === 'function') ? _nodePathHtml(n) : '';
    const self = (typeof createNodeChip === 'function') ? createNodeChip(n, { maxLen: 14, className: 'node-chip--sm' }) : '';
    el.innerHTML = path + self;
    _syncStatusBox();
    el.scrollLeft = el.scrollWidth; // 한 줄일 때 잘리는 앞쪽 대신 지금 노드가 있는 끝부터
    return;
  }
  if (!_statusPathId) return;
  if (!_statusPathLeftAt) { _statusPathLeftAt = performance.now(); return; }
  if (performance.now() - _statusPathLeftAt < STATUS_PATH_LINGER) return;
  _statusPathId = null; el.innerHTML = ''; _syncStatusBox();
}
let _rotating = false, _rotStartY = 0, _rotStartAngle = 0, _rotMoved = false, _suppressContext = false;

// 데스크탑 노드 선택: 우클릭 고정 (모바일은 더블탭)
const _pcSelectGesture = 'rightclick';

function nodeHasChildren(node) { return !!node && edges.some(e => e.from === node.id && !e.weakLink && !e.manualLink); }

// ── 포커스 모드 ────────────────────────────────────────────────────────

function applyFocusMode(nodeId, shallow = false) {
  if (!_focusMode) return;
  _focusNodeId = nodeId;
  _activeGlowIds = new Set([nodeId]); // 포커스 대상에 활성 글로우
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

// 노드 색상 표현 전환: 'node'=노드별 색, 'depth'=헤딩 깊이별 색
