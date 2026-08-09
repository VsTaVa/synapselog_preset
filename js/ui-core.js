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

// ── 노드 북마크 (켜면 노드에 주황 배지) ─────────────────────────────
// 안정 키로 저장: 노션 노드는 notionBlockId, 그 외는 노드 id
let _bookmarkedKeys = new Set((() => { try { return JSON.parse(localStorage.getItem('snlog_bookmarks') || '[]'); } catch(e) { return []; } })());
function bookmarkKey(n) { return n && (n.notionBlockId || n.id); }
function isBookmarked(n) { return !!n && _bookmarkedKeys.has(bookmarkKey(n)); }
function saveBookmarks() { try { localStorage.setItem('snlog_bookmarks', JSON.stringify([..._bookmarkedKeys])); } catch(e) {} if (typeof _activeRailSection !== 'undefined' && _activeRailSection === 'bookmarks' && typeof renderBookmarkList === 'function') renderBookmarkList(); }

// 격리 모드 지속: 격리 루트 label 저장 (fixed_pos와 동일 규칙·스코프) → 새로고침해도 복원
// 코드에선 satellite로 남겨둔다 — 페이지 격리(_isolateActive)와 이름이 겹쳐 바꾸면 더 헷갈린다
let _satelliteKeys = new Set((() => { try { return JSON.parse(snGet('snlog_satellites', 'pages') || '[]'); } catch(e) { return []; } })());
function saveSatellites() { snSet('snlog_satellites', JSON.stringify([..._satelliteKeys]), 'pages'); }
function restoreSatellites() {
  if (!_satelliteKeys.size || typeof activateSatellite !== 'function') return;
  nodes.forEach(n => { if (_satelliteKeys.has(n.label) && !n._satelliteRoot) activateSatellite(n); });
  if (typeof recomputeSatelliteFlags === 'function') recomputeSatelliteFlags();
  isStable = false;
}
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

// ── 제목 크기 ─────────────────────────────────────────────────────────

// 0(숨김)에서 돌아올 크기 — 숨긴 채 새로고침해도 원래 크기로 돌아오게 따로 저장한다
let _labelScalePrev = (() => { try { const v = parseFloat(localStorage.getItem('snlog_label_scale_prev')); return (v > 0 && v <= 2.5) ? v : 1; } catch(e) { return 1; } })();

// 단축키(T): 제목 크기를 0과 직전 값 사이로 오간다
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
  const c = (_layoutMode === 'cluster' ? visibleBBoxCenter() : visibleCentroid());
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
// 하단 중앙 상태바: 확대 % + 회전 ° 같이 표시
function showViewStatus() {
  if (!statusEl) return;
  const pct = Math.round(scale * 100);
  const deg = Math.round(((_viewRotation * 180 / Math.PI) % 360 + 360) % 360);
  statusEl.textContent = `확대 ${pct}%` + (deg ? `    ·   회전 ${deg}°` : '');
  clearTimeout(canvas._st); canvas._st = setTimeout(() => { statusEl.textContent = ''; }, 1400);
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

function toggleFocusMode() {
  const cb = document.getElementById('focus-toggle-input');
  _focusMode = cb ? cb.checked : !_focusMode;
  if (!_focusMode) { _focusNodeId = null; _activeGlowIds = new Set(); nodes.forEach(n => { n.dimmed = false; }); }
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
  if (_connectMode && s) { s.textContent = '연결 모드: 첫 번째 노드 클릭'; closePanel(); }
  else if (s) s.textContent = '';
  isStable = false;
}

// 노드 색상 표현 전환: 'node'=노드별 색, 'depth'=헤딩 깊이별 색
