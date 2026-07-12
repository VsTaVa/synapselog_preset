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

// ── 노드 북마크 (켜면 주황색 허브로 강조) ─────────────────────────────
// 안정 키로 저장: 노션 노드는 notionBlockId, 그 외는 노드 id
let _bookmarkedKeys = new Set((() => { try { return JSON.parse(localStorage.getItem('snlog_bookmarks') || '[]'); } catch(e) { return []; } })());
function bookmarkKey(n) { return n && (n.notionBlockId || n.id); }
function isBookmarked(n) { return !!n && _bookmarkedKeys.has(bookmarkKey(n)); }
function saveBookmarks() { try { localStorage.setItem('snlog_bookmarks', JSON.stringify([..._bookmarkedKeys])); } catch(e) {} if (typeof _activeRailSection !== 'undefined' && _activeRailSection === 'bookmarks' && typeof renderBookmarkList === 'function') renderBookmarkList(); }

// 위성 모드 지속: 위성 루트 label 저장 (fixed_pos와 동일 규칙·스코프) → 새로고침해도 복원
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
  CONFIG.linkWidth = parseFloat(cfgLinkWidth.value) * 1.5; // 표시값 1.0 = 실제 두께 1.5
  vRep.textContent = Math.round(parseFloat(cfgRep.value) / 100);
  vGrav.textContent = Math.round(parseFloat(cfgGrav.value) * 10000);
  vTension.textContent = Math.round(parseFloat(cfgTension.value) * 1000);
  vNodeSize.textContent = parseFloat(cfgNodeSize.value).toFixed(1);
  vLinkWidth.textContent = parseFloat(cfgLinkWidth.value).toFixed(1);
  isStable = false;
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
  // 방사형만 물리를 안 쓰므로 좌표 재계산. (클러스터는 물리라 슬라이더가 매 프레임 반영됨)
  if (_layoutMode === 'radial') applyTreeLayout();
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

function setLabelScale(v) {
  v = parseFloat(v); if (!(v >= 0.5 && v <= 2.5)) v = 1;
  _labelScale = v;
  try { localStorage.setItem('snlog_label_scale', String(v)); } catch (e) {}
  const out = document.getElementById('label-scale-val');
  if (out) out.textContent = Math.round(v * 100) + '%';
  isStable = false;
}

function setViewRotation(deg) {
  deg = ((parseFloat(deg) || 0) % 360 + 360) % 360;
  const newRot = deg * Math.PI / 180;
  // 보이는 노드 무게중심을 축으로 제자리 회전 — 회전 전 화면상 위치를 유지하도록 팬 보정
  const c = visibleCentroid();
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
  statusEl.textContent = `확대 ${pct}%` + (deg ? `   ·   회전 ${deg}°` : '');
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

// 노드 모드 (편집+탐색 통합) 토글
function toggleMultiSelectMode() {
  const cb = document.getElementById('multiselect-toggle-input');
  _multiSelectMode = cb ? cb.checked : !_multiSelectMode;
  if (!_multiSelectMode && typeof clearAllModes === 'function') clearAllModes();
  applyModeCursor();
  isStable = false;
}

// 노드 모드 커서: 주황 손가락
function _selectModeCursor() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 32 32'><path fill='%23ed7000' d='M12 2a2 2 0 0 0-2 2v12L8.5 14a2.2 2.2 0 0 0-3.1 3.1l4.5 6A6 6 0 0 0 14.7 25H19a6 6 0 0 0 6-6v-7a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0V4a2 2 0 0 0-1-2z'/></svg>`;
  return `url("data:image/svg+xml,${svg}") 10 2, pointer`;
}
function _modeCursor() {
  if (_multiSelectMode) return _selectModeCursor();
  return '';
}
// 노드 색상 표현 전환: 'node'=노드별 색, 'depth'=헤딩 깊이별 색
// ── 범례(그래프 기호 설명) 오버레이 ───────────────────────────────────
let _legendOpen = (() => { try { return localStorage.getItem('snlog_legend_open') === '1'; } catch (e) { return false; } })();
function toggleLegend() {
  _legendOpen = !_legendOpen;
  try { localStorage.setItem('snlog_legend_open', _legendOpen ? '1' : '0'); } catch (e) {}
  applyLegendState();
}
function applyLegendState() {
  const wrap = document.getElementById('legend');
  if (wrap) wrap.classList.toggle('open', _legendOpen);
  const btn = document.getElementById('rail-legend');
  if (btn) btn.classList.toggle('active', _legendOpen);
  if (_legendOpen) renderLegendBody();
}
function renderLegendBody() {
  const body = document.getElementById('legend-body');
  if (!body) return;
  const tab = (id, ic, label) => `<button class="lg-tab" data-tab="${id}" onclick="_setLegendTab('${id}')"><span class="lg-tab-ic">${ic}</span>${label}</button>`;
  const tabs = `<div class="lg-tabs">${tab('symbols', '⬡', '기호')}${tab('tools', '✦', '도구')}</div>`;
  const content = `<div class="lg-tab-body" id="lg-scroll" onscroll="_updateLegendActiveTab()">`
    + `<div class="lg-divider" id="lg-sec-symbols">그래프 기호</div>`
    + _legendSymbolsHtml()
    + `<div class="lg-divider lg-divider-gap" id="lg-sec-tools">노드 도구</div>`
    + _legendToolsHtml()
    + `</div>`;
  body.innerHTML = tabs + content;
  _updateLegendActiveTab();
}
function _setLegendTab(t) {
  const scroll = document.getElementById('lg-scroll');
  const target = document.getElementById(t === 'tools' ? 'lg-sec-tools' : 'lg-sec-symbols');
  if (scroll && target) scroll.scrollTo({ top: Math.max(0, target.offsetTop - scroll.offsetTop - 6), behavior: 'smooth' });
}
function _updateLegendActiveTab() {
  const scroll = document.getElementById('lg-scroll'); if (!scroll) return;
  const toolsEl = document.getElementById('lg-sec-tools'); if (!toolsEl) return;
  const atTools = scroll.scrollTop >= (toolsEl.offsetTop - scroll.offsetTop - 40);
  document.querySelectorAll('#legend .lg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === (atTools ? 'tools' : 'symbols')));
}
// 실제 그래프 노드 도형(drawStar8/4/X)을 작은 캔버스에 그려 이미지로 — 범례가 그래프와 완전히 일치
function _legendShapeImg(kind) {
  const S = 36, cx = 18, cy = 18;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  if (kind === 'circle') { g.fillStyle = '#c9d3e2'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill(); }
  else if (kind === 'star8' && typeof drawStar8 === 'function') { g.fillStyle = '#ffffff'; drawStar8(g, cx, cy, 8); g.fill(); }
  else if (kind === 'star4' && typeof drawStar4 === 'function') { g.fillStyle = '#eef2f8'; drawStar4(g, cx, cy, 12); g.fill(); }
  else if (kind === 'starX' && typeof drawStarX === 'function') { g.fillStyle = '#eef2f8'; drawStarX(g, cx, cy, 13.5); g.fill(); }
  return `<img class="lg-shape-img" src="${c.toDataURL()}" width="16" height="16" alt="">`;
}
function _legendSymbolsHtml() {
  const DC = (typeof DEPTH_RGB !== 'undefined') ? DEPTH_RGB : { 1:[0,207,255],2:[168,85,247],3:[255,77,184],4:[255,140,66],5:[255,210,74] };
  const dot = (rgb) => `<i class="lg-dot" style="background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})"></i>`;
  const depthMode = (typeof _colorScheme !== 'undefined' && _colorScheme === 'depth');
  const S = {
    ringDash: `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="2.2 2.2"/></svg>`,
  };
  const L = {
    solid: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="31" y2="5" stroke="#9fb0c6" stroke-width="2"/></svg>`,
    wiki: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="24" y2="5" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 3"/><path d="M23 2 L30 5 L23 8" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  };
  const glow = (c) => `<span class="lg-glow" style="background:radial-gradient(circle, ${c} 0%, transparent 70%)"></span>`;
  const colorSec = depthMode
    ? `<div class="lg-row">${dot(DC[1])}<span># · 1단계 헤딩</span></div>`
      + `<div class="lg-row">${dot(DC[2])}<span>## · 2단계</span></div>`
      + `<div class="lg-row">${dot(DC[3])}<span>### · 3단계</span></div>`
      + `<div class="lg-row">${dot(DC[4])}<span>#### · 4단계</span></div>`
      + `<div class="lg-row">${dot([245,247,250])}<span>페이지 · DB · 최상위</span></div>`
    : `<div class="lg-note">노드별 고유 색상. <b>깊이별 모드</b>에서는 헤딩 레벨(#~####)에 따라 색상이 달라집니다.</div>`;
  return `<div class="lg-sec"><div class="lg-sec-title">노드 색상</div>${colorSec}</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">노드 모양</div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendShapeImg('star8')}</span><span>페이지 (최상위)</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendShapeImg('star4')}</span><span>데이터베이스</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendShapeImg('starX')}</span><span>하위 페이지</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendShapeImg('circle')}</span><span>헤딩 (글 조각)</span></div>`
    + `</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">연결선</div>`
      + `<div class="lg-row"><span class="lg-line">${L.solid}</span><span>계층 구조</span></div>`
      + `<div class="lg-row"><span class="lg-line">${L.wiki}</span><span>노드 연결 (→ 방향)</span></div>`
    + `</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">표시</div>`
      + `<div class="lg-row"><span class="lg-shape" style="color:#ed7000;font-weight:800;font-size:12px;">가</span><span>북마크 (제목 주황색)</span></div>`
      + `<div class="lg-row">${glow('rgba(0,207,255,0.75)')}<span>노드 허브 (하위 노드 3개 이상)</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${S.ringDash}</span><span>노드 고정</span></div>`
    + `</div>`;
}
function _legendToolsHtml() {
  const ic = (inner, c) => `<span class="lg-shape"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c || '#cbd5e6'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></span>`;
  const branch = ic(`<circle cx="11" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><path d="M11 7.2V13a3 3 0 0 1-3 3H7.2"/><path d="M16 18h6M19 15v6"/>`);
  const sync = ic(`<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`);
  const notion = ic(`<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`);
  const bm = ic(`<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`, '#ed7000');
  const trash = ic(`<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`, '#e59a9a');
  const chain = ic(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`);
  const focus = ic(`<circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2"/>`);
  const path = `<span class="lg-shape" style="color:#cbd5e6;font-size:14px;font-weight:700;">↔</span>`;
  const sat = ic(`<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>`);
  const pin = ic(`<circle cx="12" cy="12" r="7.5" stroke-dasharray="2.5 2.5"/>`);
  const row = (icon, name, desc) => `<div class="lg-row lg-tool">${icon}<span><b>${name}</b>: ${desc}</span></div>`;
  return `<div class="lg-sec"><div class="lg-sec-title">편집</div>`
    + row(branch, '하위 노드 추가', '자식 노드 생성')
    + row(sync, '노드 동기화', 'Notion 최신화')
    + row(notion, '노션에서 보기', '노션 페이지로 이동')
    + row(bm, '북마크', '즐겨찾기')
    + row(trash, '노드 삭제', '삭제')
    + `</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">탐색</div>`
    + row(chain, '노드 연결', '노드 간 연결')
    + row(focus, '포커스 모드', '연결된 노드 포커스')
    + row(path, '경로 찾기', '최단 경로 표시')
    + row(sat, '위성 모드', '그래프 분리')
    + row(pin, '노드 고정', '노드 고정 및 위치 이동')
    + `</div>`
    + `<div class="lg-note">노드 <b>우클릭</b> 시 도구 툴바 표시</div>`;
}

function setColorScheme(mode) {
  _colorScheme = (mode === 'depth') ? 'depth' : 'node';
  try { localStorage.setItem('snlog_color_scheme', _colorScheme); } catch (e) {}
  const a = document.getElementById('cs-node'), b = document.getElementById('cs-depth');
  if (a) a.classList.toggle('active', _colorScheme === 'node');
  if (b) b.classList.toggle('active', _colorScheme === 'depth');
  const legend = document.getElementById('depth-legend');
  if (legend) legend.style.display = _colorScheme === 'depth' ? 'flex' : 'none';
  if (_legendOpen) renderLegendBody();
  isStable = false;
}

function toggleConnections() {
  const cb = document.getElementById('conn-toggle-input');
  _showConnections = cb ? cb.checked : !_showConnections;
  try { localStorage.setItem('snlog_show_conn', _showConnections); } catch (e) {}
  isStable = false;
}

function syncLayoutButtons() {
  const ids = { force: 'lm-force', radial: 'lm-radial', cluster: 'lm-cluster' };
  Object.keys(ids).forEach(k => {
    const el = document.getElementById(ids[k]);
    if (el) el.classList.toggle('active', _layoutMode === k);
  });
}

// 모드 커서를 전역 스타일(!important)로 주입 → 스위치/사이드바 위에서도 즉시 반영
function applyModeCursor() {
  let st = document.getElementById('mode-cursor-style');
  if (!st) { st = document.createElement('style'); st.id = 'mode-cursor-style'; document.head.appendChild(st); }
  const c = _modeCursor();
  st.textContent = c ? `*, body { cursor: ${c} !important; }` : '';
  if (canvas && !c) canvas.style.cursor = 'default';
}

// 수동연결 = A 본문에 [B](B의 노션URL) 자동 작성 → ID 기반 링크 엣지
// b가 속한 페이지의 노션 ID — 구조 부모를 올라가며 하위페이지(entryNotionId)/최상위(sourcePageId) 탐색
function _wikiPageIdFor(b) {
  let cur = b.id, g = 0;
  while (g++ < 60) {
    const n = nodeMap[cur];
    if (n) {
      if (n.entryNotionId) return String(n.entryNotionId).replace(/-/g, '');
      if (n.isChildPage && n.notionBlockId) return String(n.notionBlockId).replace(/-/g, '');
      if (n.level === 0 && n.sourcePageId && !String(n.sourcePageId).startsWith('local_') && !String(n.sourcePageId).startsWith('md_')) return String(n.sourcePageId).replace(/-/g, '');
    }
    const pe = edges.find(e => e.to === cur && !e.weakLink && !e.manualLink && !e.wikiLink);
    if (!pe) break; cur = pe.from;
  }
  // 폴백: 구조 부모 체인이 페이지 정보 노드까지 못 닿아도, 노드에 박혀있는 소속 페이지ID로 (리프 노드가 블록ID만 나오던 문제)
  if (b.sourcePageId && !String(b.sourcePageId).startsWith('local_') && !String(b.sourcePageId).startsWith('md_')) return String(b.sourcePageId).replace(/-/g, '');
  return '';
}
function _wikiUrlFor(b) {
  // 페이지ID?pvs=4#블록ID → 노션에서 그 페이지로 이동 후 블록 위치로 스크롤(단독 팝업 대신)
  if (b.notionBlockId) {
    const blk = b.notionBlockId.replace(/-/g, ''), page = _wikiPageIdFor(b);
    return page ? `https://www.notion.so/${page}?pvs=4#${blk}` : `https://www.notion.so/${blk}`;
  }
  const pid = b.entryNotionId || b.sourcePageId || '';
  if (pid && !String(pid).startsWith('local_') && !String(pid).startsWith('md_')) return `https://www.notion.so/${String(pid).replace(/-/g, '')}`;
  return `snlog:node:${b.sourcePageId || ''}:${encodeURIComponent(b.label)}`; // 로컬 폴백
}
function _wikiLinkText(b) { return `[${b.label}](${_wikiUrlFor(b)})`; }
function _linkResolvesTo(url, b) { const t = _nodeFromLinkUrl(url); return !!(t && t.id === b.id); }
function _hasWikiLinkTo(a, b) {
  const text = (a.bodyBlocks && a.bodyBlocks.length) ? a.bodyBlocks.map(x => x.text).join('\n') : (a.desc || '');
  const re = /\[([^\]]*)\]\(([^)\s]+)\)/g; let m;
  while ((m = re.exec(text))) { if (_linkResolvesTo(m[2], b)) return true; }
  return false;
}
function _wikiReflect() { if (typeof resolveWikiLinks === 'function') resolveWikiLinks(); isStable = false; refreshOpenPanes(); }
// A→B 위키 연결: 그래프 즉시 반영 + 노션 저장은 백그라운드(실패 시 롤백)
function _wikiConnect(a, b) {
  const text = _wikiLinkText(b);
  if (a.local) {
    a.desc = (a.desc && a.desc.trim()) ? (a.desc + '\n' + text) : text;
    _wikiReflect(); saveLocalPages(); return;
  }
  const blk = { id: '_tmp_' + Date.now() + Math.random().toString(36).slice(2), text, _pending: true };
  a.bodyBlocks = (a.bodyBlocks || []).concat([blk]);
  a.desc = (a.desc && a.desc.trim()) ? (a.desc + '\n' + text) : text;
  _wikiReflect(); // 그래프 즉시
  const tgt = _appendTarget(a);
  notionAppendBlocks(tgt.parentId, tgt.afterId, [text], 'paragraph').then(ids => {
    if (ids && ids[0]) { blk.id = ids[0]; delete blk._pending; invalidateNodeCache(a); }
    else throw new Error('append 실패');
  }).catch(err => {
    a.bodyBlocks = (a.bodyBlocks || []).filter(x => x.id !== blk.id);
    a.desc = (a.bodyBlocks || []).map(x => x.text).join('\n');
    _wikiReflect();
    toast('연결 저장 실패(되돌림): ' + (err.message || err), { type: 'error', duration: 4000 });
  });
}
function _wikiDisconnect(a, b) {
  const stripLine = line => line.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (mm, txt, url) => _linkResolvesTo(url, b) ? '' : mm);
  const stripDesc = () => {
    const out = [];
    (a.desc || '').split('\n').forEach(line => { const st = stripLine(line); if (st.trim() === '' && st !== line) return; out.push(st); });
    a.desc = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  if (a.local) { stripDesc(); _wikiReflect(); saveLocalPages(); return; }
  const blk = (a.bodyBlocks || []).find(x => { const re = /\[([^\]]*)\]\(([^)\s]+)\)/g; let m; while ((m = re.exec(x.text || ''))) { if (_linkResolvesTo(m[2], b)) return true; } return false; });
  if (!blk) {
    // 최상위/페이지 노드처럼 링크가 desc에만 있는 경우 → desc에서 제거해 그래프 즉시 반영
    stripDesc(); _wikiReflect(); return;
  }
  const oldText = blk.text, snapshot = (a.bodyBlocks || []).slice();
  const newText = stripLine(blk.text), removeWhole = newText.trim() === '';
  if (removeWhole) a.bodyBlocks = a.bodyBlocks.filter(x => x.id !== blk.id); else blk.text = newText;
  a.desc = (a.bodyBlocks || []).map(x => x.text).join('\n');
  _wikiReflect(); // 그래프 즉시
  if (String(blk.id).startsWith('_tmp_')) return; // 아직 노션에 안 올라간 임시 블록 → 로컬 제거로 충분(삭제 호출 시 롤백 방지)
  (removeWhole ? notionDeleteBlock(blk.id) : notionUpdateBlock(blk.id, newText))
    .then(() => invalidateNodeCache(a))
    .catch(err => {
      a.bodyBlocks = snapshot; blk.text = oldText;
      a.desc = snapshot.map(x => x.text).join('\n');
      _wikiReflect();
      toast('연결 해제 저장 실패(되돌림): ' + (err.message || err), { type: 'error', duration: 4000 });
    });
}
// 공통 토글 — 단일/멀티/순서대로 연결에서 모두 사용
function toggleWikiConnect(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const existed = _hasWikiLinkTo(a, b);
  if (existed) _wikiDisconnect(a, b); else _wikiConnect(a, b);
  return existed;
}
function handleConnectClick(n) {
  const s = document.getElementById('status');
  if (!_connectFirstNode) {
    _connectFirstNode = n; n.connectSelected = true;
    if (s) s.textContent = `"${n.label}" 선택됨 — 연결할 노드를 클릭하세요`;
    isStable = false; return;
  }
  if (_connectFirstNode.id === n.id) {
    _connectFirstNode.connectSelected = false; _connectFirstNode = null;
    if (s) s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요';
    isStable = false; return;
  }
  const a = _connectFirstNode, b = n;
  const existed = toggleWikiConnect(a, b);
  if (s) s.textContent = existed ? `"${a.label}" → "${b.label}" 연결 해제 — 계속 클릭` : `"${a.label}" → "${b.label}" 연결 — 계속 클릭`;
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

// ── 다중 선택 (우클릭/더블클릭) — 연결/경로찾기/격리 ───────────────────────

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

// 통합 노드 메뉴: 단일 선택이면 편집 툴(위) + 구분선 + 탐색 툴(아래), 다중 선택이면 탐색 툴만
function renderMultiSelectMenu() {
  const menu = document.getElementById('multi-select-menu');
  if (!menu) return;
  if (typeof _renderAiTokens === 'function') _renderAiTokens();
  if (_multiSelected.length < 1) { menu.classList.remove('open'); menu.innerHTML = ''; return; }
  let html;
  if (_multiSelected.length === 1) {
    const edit = _editToolsHtml(_multiSelected[0]);
    const explore = _exploreToolsHtml();
    html = edit + (edit && explore ? '<div class="ms-divider"></div>' : '') + explore;
  } else {
    const medit = _multiEditToolsHtml();
    const explore = _exploreToolsHtml();
    html = medit + (medit && explore ? '<div class="ms-divider"></div>' : '') + explore;
  }
  menu.innerHTML = html || `<div style="padding:7px 14px;font-size:12px;color:rgba(255,255,255,0.4);white-space:nowrap;">사용할 수 있는 동작 없음</div>`;
  menu.classList.add('open');
  repositionMultiSelectMenu();
}

// 편집 툴 (단일 노드): 하위 노드 추가 / 노드 동기화 / 북마크 / 노드 삭제
function _editToolsHtml(node) {
  if (!node) return '';
  const branchIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><path d="M11 7.2V13a3 3 0 0 1-3 3H7.2"/><path d="M16 18h6M19 15v6"/></svg>`;
  const trashIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  const syncIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  const bmOn = isBookmarked(node);
  const bmIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>${bmOn ? '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>' : ''}</svg>`;
  const notionIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const isLocalLike = node.local || String(node.sourcePageId || '').startsWith('md_') || String(node.sourcePageId || '').startsWith('local_');
  let html = '';
  if (canAddChild(node)) html += `<button onclick="multiSelectAddChild()" title="이 노드 아래에 (제목 없음) 하위 노드를 추가합니다">${branchIcon} 하위 노드 추가</button>`;
  if (!node.local && node.notionBlockId) html += `<button onclick="multiSelectSyncNode()" title="이 노드의 제목·본문을 노션에서 다시 가져옵니다">${syncIcon} 노드 동기화</button>`;
  if (!isLocalLike && (node.notionBlockId || node.sourcePageId)) html += `<button onclick="multiSelectOpenNotion()" title="이 노드를 노션에서 엽니다 (페이지로 이동 후 블록 위치로 스크롤)">${notionIcon} 노션에서 보기</button>`;
  html += `<button onclick="multiSelectBookmark()" title="이 노드를 북마크합니다. 켜면 그래프에서 주황색 허브로 빛납니다">${bmIcon} 북마크${bmOn ? ' 해제' : ''}</button>`;
  if (canDeleteNode(node)) html += `<button class="ms-danger" onclick="multiSelectDelete()" title="이 노드를 삭제합니다. 하위 노드가 있으면 상위로 옮겨집니다 (노션 노드는 영구 삭제)">${trashIcon} 노드 삭제</button>`;
  return html;
}

// 편집 툴 (다중 선택): 북마크 / 노드 삭제
function _multiEditToolsHtml() {
  const nodes = _multiSelected || [];
  if (!nodes.length) return '';
  const trashIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  const allBm = nodes.every(isBookmarked);
  const bmIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>${allBm ? '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>' : ''}</svg>`;
  let html = `<button onclick="multiSelectBookmark()" title="선택한 노드들을 북마크합니다">${bmIcon} 북마크${allBm ? ' 해제' : ''}</button>`;
  if (nodes.some(canDeleteNode)) html += `<button class="ms-danger" onclick="multiSelectDelete()" title="선택한 노드들을 삭제합니다 (노션 노드는 영구 삭제)">${trashIcon} 노드 삭제</button>`;
  return html;
}

// 탐색 툴: 연결 / 포커스 / 경로 / 위성 (선택 개수에 따라 달라짐)
function _exploreToolsHtml() {
  const n = _multiSelected.length;
  const chainIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const focusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2"/></svg>`;
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
  const satIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/></svg>`;
  html += `<button onclick="multiSelectSatellite()" title="선택한 노드와 하위 노드를 상위에서 분리해 바깥 궤도로 띄웁니다. 같은 노드를 다시 선택해 누르면 복원됩니다">${satIcon} 위성 모드${satOn ? ' 해제' : ''}</button>`;
  const pinOn = _multiSelected.length > 0 && _multiSelected.every(nd => nd.fixed);
  const pinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${pinOn ? 'rgba(237,112,0,0.25)' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
  html += `<button onclick="multiSelectPin()" title="선택한 노드를 제자리에 고정하거나 해제합니다">${pinIcon} ${pinOn ? '고정 해제' : '노드 고정'}</button>`;
  return html;
}

// ── AI (제미나이) 호출 ────────────────────────────────────────────────
// 키는 설정에서 사용자가 직접 입력(_savedAiKey). 브라우저에서 직접 호출.
const _GEMINI_MODEL = 'gemini-2.5-flash';
// AI 대화가 도구 사용법 질문에도 답할 수 있게 하는 안내
const _SYNAPSE_GUIDE = `SynapseLog는 노션 페이지·마크다운(.md)을 신경망 그래프로 시각화하는 도구다.
- 노드: 페이지/헤딩이 노드가 된다. 노드를 클릭하면 우측 패널에서 제목·본문을 보고 수정할 수 있다.
- 선택: 노드를 우클릭(모바일은 더블탭)하면 다중 선택된다.
- 연결: 노드 간 연결(a→b 링크)은 선택 메뉴의 '노드 간 연결' 또는 AI 연결 추천으로 만든다.
- 검색: 좌측 레일의 검색 아이콘에서 키워드로 노드를 찾는다.
- 배치: 그래프 설정에서 힘기반/방사형/페이지별 레이아웃과 노드 색상을 바꾼다.
- 화면: 화면 맞춤, 이미지 저장 버튼이 레일 하단에 있다.
- 좌측 레일 'AI 대화'에서 '/' 명령어로 AI 기능을 쓴다:
  · /Node Summary — 선택한 노드(상위면 하위·연결 포함) 요약
  · /Node Link — 선택 노드에 연결하면 좋은 노드 추천(연결 버튼 제공)
  · /Node Edit — 선택 노드 본문을 AI가 다듬어 편집 모드로 로드
  · /Text import — 붙여넣은 글을 요약하고 넣을 상위 노드를 추천
  · 그냥 키워드를 입력하면 그래프 노드를 검색해 그 내용을 근거로 답한다.
- 설정(⚙)에서 노션 API 토큰과 AI(구글 제미나이) API 키를 입력한다.`;
async function geminiGenerate(prompt) {
  if (!_savedAiKey) throw new Error('AI API 키가 없어 (설정에서 입력)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(_savedAiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const cand = data && data.candidates && data.candidates[0];
  const out = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
  if (!out.trim()) throw new Error('빈 응답 (안전 필터 차단일 수 있어)');
  return out.trim();
}

async function geminiSummarize(text) {
  const prompt = `다음은 지식 그래프에서 선택한 노드들의 제목과 내용이야. 핵심만 한국어로 간결하게 요약해줘.\n- 불릿 몇 개로 정리\n- 노드 간 관계나 공통 주제가 보이면 짚어줘\n- 원문에 없는 내용은 지어내지 마\n\n---\n${text}`;
  return geminiGenerate(prompt);
}

// 요약 대상 확장: 자기 자신 + 구조적 하위 노드 전체 + 연결(위키/수동 링크)된 노드
function _aiExpandNodes(baseNodes) {
  const out = [], seen = new Set();
  const add = (n) => { if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); } };
  (baseNodes || []).forEach(n => {
    add(n);
    if (typeof collectSyncDescendants === 'function') collectSyncDescendants(n).forEach(add);
  });
  const inSet = new Set(out.map(n => n.id));
  (edges || []).forEach(e => {
    if ((e.wikiLink || e.manualLink) && inSet.has(e.from)) add(nodeMap[e.to]);
  });
  return out;
}

// 노드들의 내용만 모아 AI 요약 → 좌측 AI 대화창에 표시 (노션엔 저장 안 함)
// 상위 노드면 하위 전체 + 연결된 노드까지 포함해서 요약
async function aiSummarizeNodes(nodeList) {
  const base = (nodeList || []).filter(Boolean);
  if (!base.length) return;
  if (!_savedAiKey) { toast('설정에서 AI API 키를 먼저 입력해주세요', { type: 'error' }); openSettings(); return; }
  let list = _aiExpandNodes(base);
  if (list.length > 30) list = list.slice(0, 30); // 토큰 보호(상위 노드 대량 하위 대비)
  const combined = list.map(nd => {
    const title = (nd.label || '(제목 없음)').trim();
    const body = (nd.desc || '').trim().slice(0, 350);
    return body ? `## ${title}\n${body}` : `## ${title}`;
  }).join('\n\n');
  if (_activeRailSection !== 'aichat') openRailSection('aichat');
  _aiChatPush('user', '/Node Summary', null, null, base);
  const waitId = _aiChatPush('ai', '요약하는 중… ⏳');
  try {
    const summary = await geminiSummarize(combined);
    _aiChatReplace(waitId, summary, list);
  } catch (e) {
    _aiChatReplace(waitId, '요약 실패: ' + (e.message || e), []);
  }
}

// 노드 하나에 대해 AI가 연결하면 좋은 관련 노드를 제안 → 대화창에 '연결' 버튼으로 표시
async function aiSuggestLinks(node) {
  if (!node) return;
  if (!_savedAiKey) { toast('설정에서 AI API 키를 먼저 입력해주세요', { type: 'error' }); openSettings(); return; }
  // 이미 연결(구조·위키)된 노드 + 자기 자신 제외
  const connected = new Set([node.id]);
  (edges || []).forEach(e => { if (e.from === node.id) connected.add(e.to); if (e.to === node.id) connected.add(e.from); });
  const query = (node.label || '') + ' ' + (node.desc || '').slice(0, 300);
  const cands = _aiSearchNodes(query, 16).filter(c => !connected.has(c.id)).slice(0, 8);
  if (_activeRailSection !== 'aichat') openRailSection('aichat');
  _aiChatPush('user', '/Node Link', null, null, [node]);
  if (!cands.length) { _aiChatPush('ai', '연결할 만한 관련 노드를 찾지 못했어요.'); return; }
  const waitId = _aiChatPush('ai', '연결 후보 분석 중… ⏳');
  const baseText = `${(node.label || '(제목 없음)').trim()}\n${(node.desc || '').trim().slice(0, 400)}`;
  const candText = cands.map((c, i) => `[${i + 1}] ${(c.label || '(제목 없음)').trim()}${c.desc ? ' — ' + c.desc.trim().slice(0, 120) : ''}`).join('\n');
  const prompt = `기준 노드와 의미상 연결하면 좋은 후보를 골라줘. 억지로 다 고르지 말고 관련 있는 것만. 출력은 각 줄 "[번호] 이유(한 줄)" 형식으로만, 관련된 게 없으면 "없음"이라고만 해.\n\n[기준 노드]\n${baseText}\n\n[후보]\n${candText}`;
  try {
    const ans = await geminiGenerate(prompt);
    const suggestions = [];
    const seen = new Set();
    ans.split('\n').forEach(line => {
      const m = line.match(/\[?\s*(\d+)\s*\]?[.)\s-]+(.*)$/);
      if (!m) return;
      const idx = parseInt(m[1], 10) - 1;
      const c = cands[idx];
      if (c && !seen.has(c.id)) { seen.add(c.id); suggestions.push({ aId: node.id, bId: c.id, targetLabel: (c.label || '(제목 없음)').trim(), reason: (m[2] || '').trim() }); }
    });
    if (!suggestions.length) { _aiChatReplace(waitId, '연결할 만한 관련 노드가 없었어요.', [], null); return; }
    _aiChatReplace(waitId, '아래 노드와 연결을 추천해요:', [], suggestions);
  } catch (e) {
    _aiChatReplace(waitId, '연결 제안 실패: ' + (e.message || e), [], null);
  }
}

// 노드 우클릭 메뉴 → 선택 반영 후 AI 대화창 열기 (/ 명령어로 작업)
function openAiActions(nodes) {
  if (nodes && nodes.length) {
    clearMultiSelect();
    nodes.forEach(n => { if (n) { n.multiSelected = true; _multiSelected.push(n); } });
    renderMultiSelectMenu();
  }
  if (_activeRailSection !== 'aichat') openRailSection('aichat');
}

// 글 다듬기: 노드 본문을 AI가 정리 → 대화창에 미리보기 + [적용](편집 열기)
async function aiRefineNode(node) {
  if (!node) return;
  if (!_savedAiKey) { toast('설정에서 AI API 키를 먼저 입력해주세요', { type: 'error' }); openSettings(); return; }
  const editable = node.local || (node.notionBlockId && node.notionParentId);
  if (!editable) { toast('이 노드는 본문을 편집할 수 없어요 (노션 하위 노드만)', { type: 'error' }); return; }
  const body = (node.desc || '').trim();
  if (!body) { toast('다듬을 본문이 없어요', { type: 'error' }); return; }
  if (_activeRailSection !== 'aichat') openRailSection('aichat');
  _aiChatPush('user', '/Node Edit', null, null, [node]);
  const waitId = _aiChatPush('ai', '다듬는 중… ⏳');
  const prompt = `다음 노드 본문을 다듬어줘. 의미는 그대로 유지하되 문법·맞춤법·문장 구조를 자연스럽고 명확하게 정리해줘. 내용을 새로 지어내거나 삭제하지 말고, 마크다운(불릿/번호) 형식은 살려줘. 다듬은 본문만 출력해(설명·머리말 없이).\n\n[제목] ${(node.label || '').trim()}\n[본문]\n${body.slice(0, 2000)}`;
  try {
    const refined = (await geminiGenerate(prompt)).trim();
    _aiChatReplace(waitId, refined, [], null, { nodeId: node.id, text: refined, done: false });
  } catch (e) {
    _aiChatReplace(waitId, '다듬기 실패: ' + (e.message || e), [], null, null);
  }
}

// 웹/유튜브 링크 → 서버리스로 본문·자막 추출 → 제미나이 마크다운 → 그래프 로컬 노드
async function aiImportUrl(url) {
  url = (url || '').trim();
  if (!url) { toast('/Import 뒤에 웹 주소나 유튜브 링크를 넣어주세요', { type: 'error' }); return; }
  if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 링크를 넣어주세요', { type: 'error' }); return; }
  if (!_savedAiKey) { toast('설정에서 AI API 키를 먼저 입력해주세요', { type: 'error' }); openSettings(); return; }
  if (_activeRailSection !== 'aichat') openRailSection('aichat');
  const isYt = /(?:youtube\.com|youtu\.be)/i.test(url);
  _aiChatPush('user', `/Import ${url}`);
  const waitId = _aiChatPush('ai', '링크 내용 가져오는 중… ⏳');
  try {
    const res = await fetch('/api/extract?url=' + encodeURIComponent(url));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('추출 실패 (HTTP ' + res.status + ')'));
    const srcTitle = (data.title || '').trim() || (isYt ? '유튜브 영상' : '가져온 문서');
    const bodyText = (data.text || '').trim();
    if (!bodyText) throw new Error('내용을 추출하지 못했어요 (자막 없음 / 접근 차단)');
    _aiChatReplace(waitId, '요약·마크다운 작성 중… ⏳', []);
    const prompt = `아래 ${isYt ? '유튜브 자막' : '웹 문서'} 내용을 한국어 마크다운으로 구조화해줘.\n[규칙]\n- 첫 줄은 "# 제목" 하나 (문서 전체 제목)\n- 주요 주제는 "## 소제목", 세부 내용은 "- 불릿"으로\n- 핵심만 간결히, 원문에 없는 내용은 지어내지 마\n- 코드블록·설명·머리말 없이 마크다운 본문만 출력\n\n[출처 제목] ${srcTitle}\n[내용]\n${bodyText.slice(0, 8000)}`;
    let md = (await geminiGenerate(prompt)).trim();
    md = md.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!md) throw new Error('마크다운 생성 결과가 비어있어요');
    const title = (md.match(/^#\s+(.+)$/m)?.[1] || srcTitle).trim();
    // 임시(local) 페이지로 추가 — 생성된 마크다운이라 저장 전이므로 "임시" 취급(편집·저장·내보내기 대상)
    const pageId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    mergeGraph(title, md, pageId);
    nodes.forEach(n => { if (n.sourcePageId === pageId) { n.local = true; n.visible = true; } });
    const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
    if (root) root.headingDepth = 0;
    _addedPageIds.add(pageId);
    if (typeof saveLocalPages === 'function') saveLocalPages();
    if (typeof _registerLocalInList === 'function') _registerLocalInList(pageId, title);
    if (typeof refreshSidebarRender === 'function') refreshSidebarRender();
    if (typeof updateBulkActionsVisibility === 'function') updateBulkActionsVisibility();
    isStable = false;
    _aiChatReplace(waitId, `"${title}" 를 임시 노드로 추가했어요. (${isYt ? '자막' : '본문'} 기반 — 저장하려면 사이드바에서 내보내기)`, []);
    if (typeof fitGraph === 'function') setTimeout(() => fitGraph(true), 400);
  } catch (e) {
    _aiChatReplace(waitId, '가져오기 실패: ' + (e.message || e), []);
  }
}

// ── AI 대화 (그래프 검색 기반) ────────────────────────────────────────
// 질문 → 그래프 노드 키워드 검색 → 상위 노드 텍스트만 제미나이에 넘겨 답변.
let _aiChat = [];

// 불용어(질문에서 흔히 나오지만 검색 노이즈인 단어)
const _AI_STOPWORDS = new Set(['그리고','그러나','하지만','그래서','또는','대해','대한','관련','알려','알려줘','설명','설명해','정리','정리해','무엇','뭐','뭐야','뭔','뭔데','어떤','어떻게','어때','왜','언제','어디','누구','정도','그것','이것','저것','때문','통해','위해','있는','있어','없어','해줘','해','줘','좀','것','수','및','내','나','너','알고','싶어','싶은데','관해','관하여','the','a','an','of','to','is','are','and','or','what','how','why','me','my','about','please','tell','give']);
// 한국어 조사/어미 대충 제거 (3자 이상 단어에만 적용해 짧은 단어 훼손 방지)
function _aiStem(w) {
  return w.replace(/(으로부터|에서는|에게서|으로서|으로써|이라는|라는|이라고|라고|에서|에게|한테|부터|까지|처럼|보다|이나|이란|은|는|이|가|을|를|에|의|도|와|과|랑|만|나|요|로)$/, '');
}
// 질문 → 개념(단어) 목록. 각 개념은 [어간, 원형] 변형을 가짐. 불용어 컷.
// 예: "머신러닝은 알고리즘" → [['머신러닝','머신러닝은'], ['알고리즘']]
function _aiTerms(query) {
  let raw;
  try { raw = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); }
  catch (e) { raw = (query.toLowerCase().match(/[a-z0-9가-힣]+/g) || []); }
  const concepts = [];
  raw.forEach(w => {
    if (w.length < 2 || _AI_STOPWORDS.has(w)) return;
    let s = w;
    if (/[가-힣]/.test(w) && w.length >= 3) s = _aiStem(w);
    const variants = [];
    if (s.length >= 2 && !_AI_STOPWORDS.has(s)) variants.push(s);
    if (w !== s && w.length >= 2 && !_AI_STOPWORDS.has(w)) variants.push(w);
    if (variants.length) concepts.push([...new Set(variants)]);
  });
  return concepts;
}

// 질문어와 겹치는 노드 상위 topN개.
// 정렬: 맞춘 개념 수(커버리지)↑ → 점수(제목3/본문1)↑. 약한 매칭은 컷해서 엉뚱한 근거 방지.
function _aiSearchNodes(query, topN) {
  const concepts = _aiTerms(query);
  if (!concepts.length) return [];
  const total = concepts.length;
  const scored = [];
  (nodes || []).forEach(n => {
    if (n._aiSummary) return;
    const label = (n.label || '').toLowerCase(), desc = (n.desc || '').toLowerCase();
    let score = 0, coverage = 0, labelHit = false;
    concepts.forEach(vars => {
      const inLabel = vars.some(v => label.includes(v));
      const inDesc = !inLabel && vars.some(v => desc.includes(v));
      if (inLabel) { score += 3; coverage++; labelHit = true; }
      else if (inDesc) { score += 1; coverage++; }
    });
    if (coverage === 0) return;
    // 약한 매칭 컷: 질문이 2단어 이상인데 제목매치 없고 본문에 1개만 걸리면 노이즈로 버림
    if (total >= 2 && !labelHit && coverage < 2) return;
    scored.push({ n, score, coverage });
  });
  scored.sort((a, b) => (b.coverage - a.coverage) || (b.score - a.score));
  return scored.slice(0, topN).map(s => s.n);
}

// 노드칩 배경·테두리는 그래프 뷰의 해당 노드 색(nodeRgb)에 맞추고, 글자는 흰색(가독성)
function _chipColorStyle(n) {
  let rgb = [237, 112, 0];
  try { if (n && typeof nodeRgb === 'function') { const c = nodeRgb(n); if (Array.isArray(c) && c.length >= 3) rgb = c; } } catch (e) {}
  const r = rgb[0], g = rgb[1], b = rgb[2];
  return `background:rgba(${r},${g},${b},0.2);border-color:rgba(${r},${g},${b},0.6);color:#fff !important;`;
}

// ── 통합 노드칩 컴포넌트 ──────────────────────────────────────────────
// 어디서든 createNodeChip(노드 또는 노드id) 로 생성.
// depth 색 자동 · 텍스트 유동 너비 · 10글자 초과 시 말줄임(…) + 전체 텍스트 툴팁 · 클릭 시 상세 패널.
// opts.removable → 우측에 × (선택 해제용), opts.className → 추가 클래스
function createNodeChip(node, opts) {
  opts = opts || {};
  const n = (node && typeof node === 'object') ? node : (typeof nodeMap !== 'undefined' ? nodeMap[node] : null);
  if (!n) return '';
  const full = (n.label || '').trim() || '(제목 없음)';
  const short = full.length > 10 ? full.slice(0, 10) + '…' : full;
  const x = opts.removable ? `<span class="node-chip-x" data-x="${n.id}">×</span>` : '';
  const cls = 'node-chip' + (opts.className ? ' ' + opts.className : '');
  return `<span class="${cls}" data-nid="${n.id}" title="${escapeHtml(full)}" style="${_chipColorStyle(n)}"><span class="node-chip-label">${escapeHtml(short)}</span>${x}</span>`;
}

// 노드칩 클릭(위임): 칩 → 상세 패널 열기, × → 선택 해제. 어디에 렌더돼도 동작.
document.addEventListener('click', (e) => {
  const x = e.target.closest('.node-chip-x');
  if (x) { e.stopPropagation(); if (typeof _deselectAiNode === 'function') _deselectAiNode(x.dataset.x); return; }
  const chip = e.target.closest('.node-chip');
  if (chip && chip.dataset.nid && typeof nodeMap !== 'undefined') {
    const n = nodeMap[chip.dataset.nid];
    if (n && typeof openPanel === 'function') openPanel(n);
  }
});

function _aiMdToHtml(t) {
  let s = escapeHtml(t || '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code class="wl-code">$1</code>');
  s = s.replace(/^(\s*)(\d+\.|-)(\s)/gm, '$1<span style="color:#ed7000;">$2</span>$3');
  return s.replace(/\n/g, '<br>');
}

function _renderAiChat() {
  const box = document.getElementById('aichat-messages');
  if (!box) return;
  if (!_aiChat.length) {
    box.innerHTML =
      `<div class="aichat-help">` +
        `<div class="aichat-help-title">AI 기능을 쓰려면 제미나이 API 키(무료)가 필요합니다</div>` +
        `<div class="aichat-help-step"><b>1.</b> <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 접속(구글 로그인) → <b>Create API key</b> → 키 복사 (AIza… 로 시작, 카드 등록 없이 무료)</div>` +
        `<div class="aichat-help-step"><b>2.</b> 왼쪽 아래 <b>설정(⚙)</b> → <b>AI API 키</b> 칸에 붙여넣고 <b>저장</b></div>` +
        `<div class="aichat-help-step"><b>3.</b> 이 창에서 키워드로 질문하거나, 노드 선택 후 <b>/</b> 명령어(요약·연결 추천·다듬기)로 사용</div>` +
      `</div>`;
    return;
  }
  box.innerHTML = _aiChat.map(m => {
    const bubbleInner = (m.chips && m.chips.length)
      ? escapeHtml(m.text) + ' ' + m.chips.map(n => createNodeChip(n)).join(' ')
      : _aiMdToHtml(m.text);
    let html = `<div class="aichat-msg ${m.role}"><div class="aichat-bubble">${bubbleInner}</div>`;
    if (m.refs && m.refs.length) {
      html += `<div class="aichat-refs"><div class="aichat-refs-label">근거</div>` + m.refs.map(n => createNodeChip(n)).join('') + `</div>`;
    }
    if (m.suggestions && m.suggestions.length) {
      html += `<div class="aichat-suggests">` + m.suggestions.map(s =>
        `<div class="aichat-suggest">` +
          `<div class="aichat-suggest-top">${createNodeChip(s.bId)}` +
          `<button class="aichat-connect-btn${s.done ? ' done' : ''}" data-a="${s.aId}" data-b="${s.bId}"${s.done ? ' disabled' : ''}>${s.done ? '연결됨' : '연결'}</button></div>` +
          (s.reason ? `<div class="aichat-suggest-reason">${escapeHtml(s.reason)}</div>` : '') +
        `</div>`).join('') + `</div>`;
    }
    if (m.refine) {
      html += `<div class="aichat-refine-actions"><button class="aichat-apply-btn${m.refine.done ? ' done' : ''}" data-mid="${m.id}"${m.refine.done ? ' disabled' : ''}>${m.refine.done ? '적용됨 (편집에서 저장)' : '적용 (편집 열기)'}</button></div>`;
    }
    return html + `</div>`;
  }).join('');
  box.querySelectorAll('.aichat-connect-btn:not(.done)').forEach(el => {
    el.onclick = () => applyAiLink(el.dataset.a, el.dataset.b);
  });
  box.querySelectorAll('.aichat-apply-btn:not(.done)').forEach(el => {
    el.onclick = () => applyAiRefineFromMsg(el.dataset.mid);
  });
  box.scrollTop = box.scrollHeight;
}

function _aiChatPush(role, text, refs, suggestions, chips) {
  const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
  _aiChat.push({ id, role, text, refs: refs || [], suggestions: suggestions || null, chips: chips || null });
  _renderAiChat();
  return id;
}
function _aiChatReplace(id, text, refs, suggestions, refine) {
  const m = _aiChat.find(x => x.id === id);
  if (m) { m.text = text; m.refs = refs || []; if (suggestions !== undefined) m.suggestions = suggestions; if (refine !== undefined) m.refine = refine; }
  _renderAiChat();
}

// AI 다듬기 '적용' → 노드를 편집 모드로 열고 다듬은 텍스트 로드(최종 저장은 사용자가 [저장])
function applyAiRefineFromMsg(mid) {
  const m = _aiChat.find(x => x.id === mid);
  if (!m || !m.refine) return;
  const node = nodeMap[m.refine.nodeId];
  if (!node) { toast('노드를 찾을 수 없어요', { type: 'error' }); return; }
  openPanel(node);
  const idx = _stack.findIndex(x => x.id === node.id);
  if (idx < 0) return;
  m.refine.done = true; _renderAiChat();
  setTimeout(() => { try { beginNodeEdit(idx, node, m.refine.text); } catch (e) {} }, 90);
}

// AI 연결 제안의 '연결' 버튼 → a→b 위키 링크 생성(노션 저장은 백그라운드)
function applyAiLink(aId, bId) {
  const a = nodeMap[aId], b = nodeMap[bId];
  if (!a || !b) return;
  if (!_hasWikiLinkTo(a, b)) _wikiConnect(a, b);
  _aiChat.forEach(m => (m.suggestions || []).forEach(s => { if (s.aId === aId && s.bId === bId) s.done = true; }));
  _renderAiChat();
}

// ── AI 슬래시 명령어 (확장 가능) ─────────────────────────────────────
const _AI_COMMANDS = [
  { name: '/Node Summary', hint: '선택한 노드 요약', run: () => { if (!_multiSelected.length) { toast('노드를 먼저 선택해주세요', { type: 'error' }); return; } const ns = _multiSelected.slice(); clearMultiSelect(); aiSummarizeNodes(ns); } },
  { name: '/Node Link', hint: '선택한 노드의 연결 추천', run: () => { if (_multiSelected.length !== 1) { toast('노드 1개를 선택해주세요', { type: 'error' }); return; } const n = _multiSelected[0]; clearMultiSelect(); aiSuggestLinks(n); } },
  { name: '/Node Edit', hint: '선택한 노드 본문 다듬기', run: () => { if (_multiSelected.length !== 1) { toast('노드 1개를 선택해주세요', { type: 'error' }); return; } const n = _multiSelected[0]; clearMultiSelect(); aiRefineNode(n); } },
  { name: '/Import', hint: '웹·유튜브(자막) 링크를 마크다운 노드로 가져오기', run: (text) => aiImportUrl(text) },
];
function _matchAiCommand(raw) {
  const lower = (raw || '').toLowerCase();
  return _AI_COMMANDS.find(c => {
    const n = c.name.toLowerCase();
    return lower === n || (lower.startsWith(n) && /\s/.test(lower.charAt(n.length)));
  });
}
// 자연어에서 노드 작업 의도 파악 (선택 노드가 있을 때만 사용) → 'summary' | 'link' | 'edit' | null
function _matchNodeIntent(raw) {
  const s = (raw || '');
  if (/요약|간추|핵심만|줄여/.test(s)) return 'summary';
  if (/다듬|고쳐|교정|매끄/.test(s)) return 'edit';
  if (/연결|링크|이어|연관|관련\s*노드/.test(s)) return 'link';
  return null;
}
// 명령어 메뉴는 body에 붙여 fixed로 띄운다 (사이드바 overflow/transform에 안 잘리게)
let _aiCmdMenuEl = null;
function _aiCmdMenuOutside(e) {
  const btn = document.getElementById('aichat-cmd');
  if (_aiCmdMenuEl && !_aiCmdMenuEl.contains(e.target) && !(btn && btn.contains(e.target))) _closeAiCmdMenu();
}
function _closeAiCmdMenu() {
  if (_aiCmdMenuEl) { document.removeEventListener('mousedown', _aiCmdMenuOutside); _aiCmdMenuEl.remove(); _aiCmdMenuEl = null; }
}
function _hideAiCmdMenu() { _closeAiCmdMenu(); }
function _showAiCmdMenu(list) {
  _closeAiCmdMenu();
  if (!list || !list.length) return;
  const bar = document.querySelector('.aichat-input-row') || document.querySelector('.aichat-bar');
  if (!bar) return;
  const menu = document.createElement('div');
  menu.className = 'aichat-cmd-menu';
  menu.innerHTML = list.map(c => `<button class="ai-cmd-item" data-cmd="${escapeHtml(c.name)}"><span class="ai-cmd-name">${escapeHtml(c.name)}</span><span class="ai-cmd-hint">${escapeHtml(c.hint)}</span></button>`).join('');
  document.body.appendChild(menu);
  const r = bar.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.width = r.width + 'px';
  menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  // 바 위쪽 여유공간에 높이를 맞춰서, 넘치면 화면 밖으로 잘리지 않고 스크롤되게
  menu.style.maxHeight = Math.max(120, Math.min(r.top - 14, window.innerHeight * 0.5)) + 'px';
  menu.querySelectorAll('.ai-cmd-item').forEach(el => { el.onmousedown = (e) => { e.preventDefault(); _pickAiCommand(el.dataset.cmd); }; });
  _aiCmdMenuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', _aiCmdMenuOutside), 0);
}
function toggleAiCmdMenu() {
  if (_aiCmdMenuEl) { _closeAiCmdMenu(); return; }
  _showAiCmdMenu(_AI_COMMANDS);
}
function _pickAiCommand(name) {
  const cmd = _AI_COMMANDS.find(c => c.name === name);
  _closeAiCmdMenu();
  if (cmd && cmd.name.indexOf('/Node') === 0) { _enterCmdMode(cmd); return; }
  const input = document.getElementById('aichat-input');
  if (input) { input.value = name + ' '; input.focus(); _autoGrowAiInput(input); }
}
function _autoGrowAiInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 72) + 'px';
}
// 노드 명령어를 입력란 안의 pill로 표시하고 그 옆에 선택 노드칩 (/Node Edit [노드칩])
let _aiActiveCmd = null;
function _enterCmdMode(cmd) {
  _aiActiveCmd = cmd;
  const input = document.getElementById('aichat-input');
  if (input) { input.value = ''; input.placeholder = ''; _autoGrowAiInput(input); input.focus(); }
  _closeAiCmdMenu();
  _renderAiTokens();
}
function _exitCmdMode() {
  _aiActiveCmd = null;
  const input = document.getElementById('aichat-input');
  if (input) input.placeholder = (typeof t === 'function' ? t('ai-chat-ph') : '') || '키워드 입력하여 AI와 대화 시작';
  _renderAiTokens();
}
function _renderAiTokens() {
  const box = document.getElementById('aichat-tokens');
  if (!box) return;
  const input = document.getElementById('aichat-input');
  const nodes = _multiSelected || [];
  if (!_aiActiveCmd && !nodes.length) {
    box.innerHTML = ''; box.style.display = 'none';
    if (input && !_aiActiveCmd) input.placeholder = (typeof t === 'function' ? t('ai-chat-ph') : '') || '키워드 입력하여 AI와 대화 시작';
    return;
  }
  let html = _aiActiveCmd ? `<span class="aichat-cmd-pill">${escapeHtml(_aiActiveCmd.name)}</span>` : '';
  html += nodes.map(n => createNodeChip(n, { removable: true })).join('');
  box.innerHTML = html;
  box.style.display = 'flex';
  if (input) input.placeholder = ''; // 칩·명령어 있으면 안내문 숨김
}
// 입력란 노드칩의 X → 그 노드 선택 해제
function _deselectAiNode(id) {
  const idx = _multiSelected.findIndex(n => n.id === id);
  if (idx >= 0) { if (_multiSelected[idx]) _multiSelected[idx].multiSelected = false; _multiSelected.splice(idx, 1); }
  if (typeof renderMultiSelectMenu === 'function') renderMultiSelectMenu();
  isStable = false;
}
function onAiKeydown(e) {
  const input = e.target;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiChat(); return; }
  if (e.key === 'Backspace' && _aiActiveCmd && !input.value) { e.preventDefault(); _exitCmdMode(); }
}
function onAiInput(el) {
  _autoGrowAiInput(el);
  const v = el.value || '';
  const trimmed = v.trim();
  const exact = _AI_COMMANDS.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (exact && exact.name.indexOf('/Node') === 0) { _enterCmdMode(exact); return; }
  if (v.startsWith('/')) {
    const q = v.toLowerCase().trim();
    const list = _AI_COMMANDS.filter(c => c.name.toLowerCase().startsWith(q));
    if (list.length) _showAiCmdMenu(list); else _closeAiCmdMenu();
  } else _closeAiCmdMenu();
}

// 질문 → Gemini 1차 호출로 검색용 핵심 키워드(+유사어) 추출. 실패하면 원 질문 그대로.
async function _aiExtractKeywords(query) {
  const q = (query || '').trim();
  if (q.length < 3) return q; // 아주 짧으면 추출 생략(비용/의미 없음)
  try {
    const prompt = `다음 질문에서 지식 그래프 노드 검색에 쓸 핵심 키워드만 뽑아줘.\n[규칙]\n- 조사·동사·불필요어(대해, 생각, 알려줘, 설명, 정리 등) 제거\n- 핵심 명사 위주로\n- 동의어/유사어가 있으면 함께 (예: 인간 → 인간, 사람 / AI → AI, 인공지능)\n- 쉼표로 구분한 키워드만 출력 (문장·설명·따옴표 금지)\n\n질문: ${q}`;
    const out = (await geminiGenerate(prompt)).trim();
    const kws = out.split(/[\n,·、]/).map(s => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    if (!kws.length) return q;
    return kws.join(' ');
  } catch (e) {
    return q; // 1차 실패 시 원 질문으로 폴백
  }
}

async function sendAiChat() {
  const input = document.getElementById('aichat-input');
  // pill 모드(노드 명령어)면 선택 노드로 실행
  if (_aiActiveCmd) {
    const cmd = _aiActiveCmd;
    _exitCmdMode();
    if (input) { input.value = ''; _autoGrowAiInput(input); }
    _hideAiCmdMenu();
    cmd.run('');
    return;
  }
  const q = (input && input.value || '').trim();
  if (!q) return;
  // 슬래시 명령어면 해당 모드로 라우팅 (AI가 명령어 인식)
  const cmd = _matchAiCommand(q);
  if (cmd) {
    const rest = q.slice(cmd.name.length).trim();
    if (input) { input.value = ''; _autoGrowAiInput(input); }
    _hideAiCmdMenu();
    cmd.run(rest);
    return;
  }
  // 노드가 선택돼 있고 자연어에 의도(요약/연결/다듬기)가 담겨 있으면 → 선택 노드로 해당 작업 실행
  if (_multiSelected.length >= 1) {
    const intent = _matchNodeIntent(q);
    if (intent) {
      if (input) { input.value = ''; _autoGrowAiInput(input); }
      _hideAiCmdMenu();
      if (intent === 'summary') { const ns = _multiSelected.slice(); clearMultiSelect(); aiSummarizeNodes(ns); return; }
      if (_multiSelected.length !== 1) { toast('이 작업은 노드 1개만 선택해주세요', { type: 'error' }); return; }
      const n = _multiSelected[0]; clearMultiSelect();
      if (intent === 'link') aiSuggestLinks(n); else aiRefineNode(n);
      return;
    }
  }
  if (!_savedAiKey) { toast('설정에서 AI API 키를 먼저 입력해주세요', { type: 'error' }); openSettings(); return; }
  if (input) { input.value = ''; _autoGrowAiInput(input); }
  _aiChatPush('user', q);
  const waitId = _aiChatPush('ai', '생각하는 중… ⏳');
  try {
    // 1차: 질문에서 핵심 키워드(+유사어) 추출 → 그걸로 노드 검색 (엉뚱한 노드 근거 줄이기)
    const searchQuery = await _aiExtractKeywords(q);
    const matched = _aiSearchNodes(searchQuery, 6);
    const context = matched.map((n, i) => {
      const body = (n.desc || '').trim().slice(0, 500);
      return `[${i + 1}] ${(n.label || '(제목 없음)').trim()}${body ? '\n' + body : ''}`;
    }).join('\n\n');
    const prompt = context
      ? `너는 SynapseLog(지식 그래프 도구)의 AI 조수야. 한국어로 답해줘.\n- 도구 사용법/기능을 물으면 [도구 안내]를 근거로 답해.\n- 지식 내용을 물으면 [검색된 노드]를 근거로 답하고, 없는 내용은 지어내지 마.\n\n[도구 안내]\n${_SYNAPSE_GUIDE}\n\n[검색된 노드]\n${context}\n\n[질문]\n${q}`
      : `너는 SynapseLog(지식 그래프 도구)의 AI 조수야. 한국어로 답해줘. 관련된 노드는 못 찾았어.\n- 도구 사용법/기능을 묻는 질문이면 [도구 안내]를 근거로 답해.\n- 그 외에는 그래프에 근거가 없다는 점을 밝히고 일반적으로 짧게만 답해.\n\n[도구 안내]\n${_SYNAPSE_GUIDE}\n\n[질문]\n${q}`;
    const ans = await geminiGenerate(prompt);
    _aiChatReplace(waitId, ans, matched);
  } catch (e) {
    _aiChatReplace(waitId, '실패: ' + (e.message || e), []);
  }
}

// 선택 노드 고정/해제 (노드 선택 툴바)
function multiSelectPin() {
  if (_multiSelected.length < 1) return;
  const targets = _multiSelected.slice();
  const allFixed = targets.every(n => n.fixed);
  targets.forEach(n => {
    n.fixed = !allFixed;
    if (!n.fixed) { n.vx = 0; n.vy = 0; delete n._satFixed; }
    if (typeof unfreezeSubtree === 'function') unfreezeSubtree(n);
  });
  if (typeof saveFixedPositions === 'function') saveFixedPositions();
  isStable = false;
  renderMultiSelectMenu();
}

function repositionMultiSelectMenu() {
  if (_multiSelected.length < 1) return;
  const menu = document.getElementById('multi-select-menu');
  if (!menu || !menu.classList.contains('open')) return;
  const last = _multiSelected[_multiSelected.length - 1];
  const _sp = (typeof worldToScreen === 'function') ? worldToScreen(last.x, last.y) : { x: (last.x - W / 2) * scale + W / 2 + panX, y: (last.y - H / 2) * scale + H / 2 + panY };
  const screenX = _sp.x, screenY = _sp.y;
  // 노드 바로 오른쪽에, 세로로는 노드 중심에 맞춰 배치
  const rad = (typeof nodeR === 'function' ? nodeR(last.level) : 8) * scale;
  menu.style.left = (screenX + rad + 12) + 'px';
  menu.style.top = (screenY - menu.offsetHeight / 2) + 'px';
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
  const [a, b] = _multiSelected; // a→b 방향
  toggleWikiConnect(a, b);
  clearMultiSelect();
}

function multiSelectChainConnect() {
  if (_multiSelected.length < 3) return;
  const seq = _multiSelected.slice(); // 선택 순서대로 a→b→c
  const pairs = [];
  for (let i = 0; i < seq.length - 1; i++) pairs.push([seq[i], seq[i + 1]]);
  const allLinked = pairs.every(([a, b]) => _hasWikiLinkTo(a, b));
  if (allLinked) pairs.forEach(([a, b]) => _wikiDisconnect(a, b));
  else pairs.forEach(([a, b]) => { if (!_hasWikiLinkTo(a, b)) _wikiConnect(a, b); });
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
  if (typeof _satelliteKeys !== 'undefined') { _satelliteKeys.add(node.label); saveSatellites(); }
}

function releaseSatellite(node) {
  // 이 루트가 분리했던 부모 엣지 복원
  _satelliteRemovedEdges.filter(e => e._satRoot === node.id).forEach(e => { delete e._satRoot; edges.push(e); });
  _satelliteRemovedEdges = _satelliteRemovedEdges.filter(e => e._satRoot !== node.id);
  node._satelliteRoot = false;
  if (typeof _satelliteKeys !== 'undefined') { _satelliteKeys.delete(node.label); saveSatellites(); }
  // 위성 드래그로 자동 고정됐던 경우만 해제 (수동 고정은 유지)
  if (node._satFixed) { node.fixed = false; node.vx = 0; node.vy = 0; delete node._satFixed; }
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

function multiSelectBookmark() {
  if (_multiSelected.length < 1) return;
  const targets = _multiSelected.slice();
  clearMultiSelect();
  const allOn = targets.every(isBookmarked);
  targets.forEach(n => { const k = bookmarkKey(n); if (allOn) _bookmarkedKeys.delete(k); else _bookmarkedKeys.add(k); });
  saveBookmarks();
  isStable = false;
}

function multiSelectSyncNode() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  syncNode(node);
}

function multiSelectOpenNotion() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  const url = _wikiUrlFor(node);
  if (url && /^https?:/i.test(url)) window.open(url, '_blank');
  else toast('이 노드는 노션 링크가 없어요 (로컬·MD 노드)', { type: 'error' });
}

function multiSelectAddChild() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  if (!canAddChild(node)) { toast('이 노드에는 하위 노드를 만들 수 없어요 (최하위/제한 노드)', { type: 'error' }); return; }
  createChildNode(node, '(제목 없음)').then(ids => { if (ids.length && nodeMap[ids[0]]) openPanel(nodeMap[ids[0]]); toast('하위 노드 추가됨', { type: 'success' }); }).catch(err => toast('하위 노드 추가 실패: ' + (err.message || err), { type: 'error', duration: 5000 }));
}

function multiSelectDelete() {
  if (_multiSelected.length < 1) return;
  if (_multiSelected.length === 1) { const node = _multiSelected[0]; clearMultiSelect(); deleteNodeSmart(node); return; }
  const targets = _multiSelected.slice();
  clearMultiSelect();
  const deletable = targets.filter(canDeleteNode);
  if (!deletable.length) { toast('선택한 노드는 삭제할 수 없어요 (페이지·DB 노드는 목록 ✕로)', { type: 'error' }); return; }
  const skipped = targets.length - deletable.length;
  const totalCount = deletable.reduce((s, n) => s + _subtreeIds(n.id).length, 0);
  const hasNotion = deletable.some(n => !n.local);
  const msg = `${deletable.length}개 노드(하위 포함 총 ${totalCount}개)를 삭제할까요?`
    + (skipped ? `\n(삭제 불가 ${skipped}개는 제외)` : '')
    + (hasNotion ? '\n(노션에서 삭제 — 실행 취소 가능)' : '');
  showConfirm('노드 삭제', msg, async () => {
    _undoDelete = { entries: [] };
    for (const n of deletable) { await deleteNodeSubtree(n); }
    const cnt = _undoDelete.entries.length;
    if (cnt) toast(`${cnt}개 노드 삭제됨`, { type: 'success', duration: 6000, action: { label: '실행 취소', onClick: undoLastDelete } });
    else _undoDelete = null;
  }, true);
}

// ── 사이드바 토글 ─────────────────────────────────────────────────────

// 패널 열고/닫을 때 트랜지션(0.28s) 후 화면 맞춤
function _autoFitPanel() { setTimeout(() => { try { fitGraph(false); } catch (e) {} }, 320); }

// ── 좌측 액티비티 레일: 섹션 플라이아웃 ──────────────────────────────
let _activeRailSection = null;
const _railSections = ['pages', 'search', 'bookmarks', 'graphcfg', 'aichat'];
function openRailSection(name) {
  if (_activeRailSection === name) { closeRailFlyout(); return; }
  _activeRailSection = name;
  document.querySelectorAll('#sidebar .rail-pane').forEach(el => el.classList.toggle('active', el.dataset.section === name));
  _railSections.forEach(k => { const b = document.getElementById('rail-' + k); if (b) b.classList.toggle('active', k === name); });
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.add('open');
  if (name === 'search') setTimeout(() => document.getElementById('search-input')?.focus(), 60);
  if (name === 'aichat') { setTimeout(() => document.getElementById('aichat-input')?.focus(), 60); if (typeof _renderAiChat === 'function') _renderAiChat(); }
  if (name === 'bookmarks') renderBookmarkList();
}

// 북마크한 노드 목록 (레일 섹션) — 클릭 시 그 노드로 이동 + 패널 열기
function renderBookmarkList() {
  const el = document.getElementById('bookmark-list');
  if (!el) return;
  const bmIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#ed7000" stroke="#ed7000" stroke-width="1.5" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  const list = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && isBookmarked(n));
  if (!list.length) {
    el.innerHTML = `<div class="bm-empty">아직 북마크한 노드가 없어요.<br>노드를 선택하고 <b>북마크</b>를 누르면 여기에 모여요.</div>`;
    return;
  }
  el.innerHTML = list.map(n => `<div class="bm-item" data-nid="${n.id}" title="${escapeHtml((n.label || '(제목 없음)').trim())}"><span class="bm-ic">${bmIcon}</span><span class="bm-label">${escapeHtml((n.label || '(제목 없음)').trim())}</span></div>`).join('');
  el.querySelectorAll('.bm-item').forEach(row => {
    row.onclick = () => {
      const n = nodeMap[row.dataset.nid];
      if (!n) return;
      openPanel(n);
      if (typeof focusViewOnNode === 'function') focusViewOnNode(n);
    };
  });
}
function closeRailFlyout() {
  if (!_activeRailSection) return;
  _activeRailSection = null;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
  _railSections.forEach(k => { const b = document.getElementById('rail-' + k); if (b) b.classList.remove('active'); });
}
function toggleSidebar() { closeRailFlyout(); } // 구버전 호환(Esc 등)

// 좌측 레일 로고 → 처음 시작(노션 연결·MD) 화면 다시 열기 (확인 후)
function backToLoginScreen() {
  showConfirm('시작 화면으로', '노션 연결 · 시작 화면으로 돌아갈까요?\n현재 그래프는 그대로 유지됩니다.', () => {
    closeRailFlyout();
    const ls = document.getElementById('login-screen');
    if (ls) ls.style.display = '';
    const tokenIn = document.getElementById('input-token');
    if (tokenIn && _savedToken) tokenIn.value = _savedToken;
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
  }, true);
}

// ── 디테일 패널 (탭) ──────────────────────────────────────────────────

let _detailPanelCollapsed = false;

// 우측 패널: 1개(단일) 또는 2개(상하 분할)의 독립 패인.
// 우측 패널: 탭 없이 노드 패널을 세로로 쌓는다(최대 2개, FIFO). 새 노드 클릭 시 아래에 추가, 넘치면 맨 위 제거.
const MAX_STACK = 2;
let _stack = []; // 열린 노드(위→아래), 최신이 마지막
let _activeNode = null; // 현재 패널에 열린(선택된) 노드
let _undoDelete = null; // 마지막 삭제 묶음 (실행 취소용)

function anyTabs() { return _stack.length > 0; }

// 위·아래 패널 순서 교체
function swapPanes() {
  if (_stack.length < 2) return;
  _stack.reverse();
  renderPanes();
}

// 특정 패널(스택 i번)만 닫기
function closePaneAt(i) {
  if (i < 0 || i >= _stack.length) return;
  const removed = _stack[i];
  _stack.splice(i, 1);
  if (_activeNode === removed) _activeNode = _stack.length ? _stack[_stack.length - 1] : null;
  if (!_stack.length) closePanel();
  else { renderPanes(); updateDetailReopenTab(); }
}

// 증분 동기화/삭제로 사라진 노드를 스택에서 정리
function pruneDetailTabs(removedIds) {
  const before = _stack.length;
  _stack = _stack.filter(n => !removedIds.has(n.id));
  if (_activeNode && removedIds.has(_activeNode.id)) _activeNode = null;
  if (_stack.length !== before) { if (!_stack.length) closePanel(); else renderPanes(); }
}

// 동기화 후 열린 패널 내용 다시 그리기 (제자리 갱신된 노드 텍스트 반영)
function refreshOpenPanes() { if (anyTabs()) renderPanes(); }
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
  _autoFitPanel();
}

function reopenDetailPanel() {
  if (!anyTabs()) return;
  if (detailPanel.classList.contains('open')) { _detailPanelCollapsed = false; detailPanel.classList.remove('panel-collapsed'); }
  else { showPanel(); }
  updateDetailReopenTab();
  _autoFitPanel();
}

const _paneCollapseIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;

// 스택(_stack)을 DOM에 반영 — 위→아래로 쌓고, 2개면 상하 분할. animateId 노드는 진입 애니메이션
function renderPanes(animateId) {
  const wrap = document.getElementById('detail-panes');
  if (!wrap) return;
  wrap.classList.toggle('split', _stack.length >= 2);
  wrap.innerHTML = '';
  _stack.forEach((node, i) => {
    const el = document.createElement('div');
    el.className = 'detail-pane' + (animateId && node.id === animateId ? ' pane-enter' : '');
    el.dataset.pane = i;
    el.innerHTML =
      `<div class="detail-pane-bar">` +
        `<span class="pane-bar-spacer"></span>` +
        (_stack.length >= 2 ? `<button class="pane-swap-btn" title="위·아래 패널 교체"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V5M7 5 4 8M7 5l3 3"/><path d="M17 3v16M17 19l3-3M17 19l-3-3"/></svg></button>` : '') +
        `<button class="pane-collapse-btn" title="패널 접기">${_paneCollapseIcon}</button>` +
        `<button class="pane-x" title="이 패널 닫기">✕</button>` +
      `</div>` +
      `<div class="detail-body">` +
        `<div class="detail-title-row"><div class="detail-title-main"><div class="detail-title"></div></div><div class="detail-title-actions"></div></div>` +
        `<div class="detail-meta-row"><span class="detail-date"></span></div>` +
        `<div class="detail-divider"></div>` +
        `<div class="detail-content"></div>` +
      `</div>`;
    const swb = el.querySelector('.pane-swap-btn');
    if (swb) swb.onclick = (e) => { e.stopPropagation(); swapPanes(); };
    el.querySelector('.pane-collapse-btn').onclick = (e) => { e.stopPropagation(); toggleDetailPanel(); };
    el.querySelector('.pane-x').onclick = (e) => { e.stopPropagation(); closePaneAt(i); };
    wrap.appendChild(el);
    renderPaneContent(i, node);
  });
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
  if (titleEl) { titleEl.textContent = n.label; titleEl.title = n.label; }
  if (dateEl) {
    if (n.date) { dateEl.style.display = 'inline'; dateEl.textContent = n.date; }
    else { dateEl.style.display = 'none'; }
  }
  // 노션에서 보기 / 북마크는 설정(⚙) 메뉴로 이동 — 예전 직접 아이콘이 남아있으면 제거
  titleRow.querySelectorAll('.detail-notion-link, .detail-bookmark-btn').forEach(el => el.remove());
  // 노션에서 보기 링크 대상 (로컬/MD 노드는 없음)
  const isLocalLike = n.local || String(n.sourcePageId || '').startsWith('md_');
  // 노드 연결 링크와 동일하게 페이지ID 포함(notion.so/<page>?pvs=4#<block>) → 페이지 이동+블록 스크롤
  const notionHref = isLocalLike ? '' : _wikiUrlFor(n);

  const titleActions = titleRow.querySelector('.detail-title-actions') || titleRow;
  // AI 요약 가짜 노드는 톱니(수정·동기화·삭제 등) 없이 본문만 표시
  if (!n._aiSummary) {
  // 모든 동작(수정·동기화·하위추가·노션보기·북마크·삭제)을 ⚙ 메뉴 하나로 통합
  let setBtn = titleRow.querySelector('.detail-settings-btn');
  if (!setBtn) {
    setBtn = document.createElement('button');
    setBtn.className = 'detail-edit-btn detail-settings-btn';
    setBtn.title = '메뉴 (수정·동기화·추가·북마크·삭제)';
    setBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    titleActions.appendChild(setBtn);
  }
  setBtn.onclick = (e) => { e.stopPropagation(); toggleDetailSettings(setBtn, i, n, notionHref); };
  if (titleEl && titleActions && titleActions !== titleRow) {
    requestAnimationFrame(() => { titleEl.style.paddingRight = (titleActions.offsetWidth + 10) + 'px'; });
  }
  }

  let rawDesc = escapeHtml(n.desc || '(내용 없음)')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="wl-code">$1</code>')
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  // 목록 마커("1. ", "- ")를 주황색으로 강조 (줄머리만)
  rawDesc = rawDesc.replace(/^(\s*)(\d+\.|-)(\s)/gm, '$1<span style="color:#ed7000;">$2</span>$3');
  // 화살표(-> 또는 →)도 주황색 (escapeHtml 후 > 는 &gt;)
  rawDesc = rawDesc.replace(/(-&gt;|→)/g, '<span style="color:#ed7000;">$1</span>');
  // [텍스트](url) → 링크. 노드로 해석되면 내부 이동, 아니면 외부 링크. (원문 이스케이프됨: & 는 &amp;)
  rawDesc = rawDesc.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (mm, txt, url) => {
    const decUrl = url.replace(/&amp;/g, '&');
    const target = (typeof _nodeFromLinkUrl === 'function') ? _nodeFromLinkUrl(decUrl) : null;
    // 수정 모드와 동일하게 칩(🔗 + 제목만, URL 숨김)으로 표시
    if (target) return `<span class="wl-ref wl-chip" data-nid="${target.id}" style="${_chipColorStyle(target)}">${txt}</span>`;
    return `<a class="wl-ref wl-chip wl-ext" href="${url}" target="_blank" rel="noopener">${txt}</a>`;
  });
  if (searchKeyword && searchMatches.has(n.id)) {
    const re = new RegExp(`(${searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    rawDesc = rawDesc.replace(re, '<mark style="background:rgba(237,112,0,0.35);color:#ed7000;border-radius:3px;padding:0 2px;">$1</mark>');
  }
  if (contentEl) {
    contentEl.innerHTML = mdTableToHtml(rawDesc);
    // 위키링크 클릭 → 해당 노드 열기
    contentEl.querySelectorAll('.wl-ref[data-nid]').forEach(el => {
      el.addEventListener('click', () => { const tn = nodeMap[el.dataset.nid]; if (tn) openPanel(tn); });
    });
    if (searchKeyword && searchMatches.has(n.id)) {
      setTimeout(() => { const mark = contentEl.querySelector('mark'); if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
    }
  }

}


// 노션 헤딩 노드의 하위 트리(자식 헤딩) 수집 — 약한링크/수동링크 제외
function collectSyncDescendants(rootNode) {
  const out = [], seen = new Set([rootNode.id]), q = [rootNode.id];
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => {
      if (e.from === id && !e.weakLink && !e.manualLink && !seen.has(e.to)) {
        seen.add(e.to); const cn = nodeMap[e.to];
        if (cn) { out.push(cn); q.push(e.to); }
      }
    });
  }
  return out;
}

// 노드 1개를 노션에서 다시 가져와 제목/본문/토글 갱신 (UI 갱신·캐시 무효화는 호출자에서)
async function _applyNodeSync(node) {
  const data = await notionFetch({ action: 'headingNode', blockId: node.notionBlockId, parentId: node.notionParentId });
  const newTitle = (data.title || '').trim();
  if (newTitle && newTitle !== node.label) {
    node.label = newTitle;
    refreshOpenPanes();
  }
  if (typeof data.toggleable === 'boolean' && !!data.toggleable !== !!node.notionToggle) node.notionToggle = !!data.toggleable;
  const lines = Array.isArray(data.body) ? data.body : [];
  node.bodyBlocks = lines.map(b => ({ id: b.id, text: bodyBlockText(b.line) }));
  node.desc = cleanDesc(lines.map(b => b.line).join('\n'));
}

// 해당 노드 + 하위 노드들을 노션에서 다시 가져와 갱신 (제목 + 본문)
async function syncNode(node, paneIdx) {
  if (!node || node.local) { toast('이 노드는 동기화할 수 없어 (노션 노드만)', { type: 'error' }); return; }
  // 노션 페이지에 속한 노드는 페이지 전체를 증분 동기화 → 하위 헤딩 추가/삭제/이동 등 구조 변경까지 반영
  const pid = node.sourcePageId;
  if (pid && !String(pid).startsWith('local_') && !String(pid).startsWith('md_') && typeof syncPage === 'function') {
    try { await syncPage(pid, {}); toast('동기화됨', { type: 'success' }); }
    catch (err) { toast('동기화 실패: ' + (err.message || err), { type: 'error', duration: 5000 }); }
    return;
  }
  if (!node.notionBlockId) { toast('이 노드는 동기화할 수 없어 (노션 헤딩 노드만)', { type: 'error' }); return; }
  const targets = [node, ...collectSyncDescendants(node)].filter(t => t && t.notionBlockId && !t.local);
  const dismiss = toast(targets.length > 1 ? `노드 ${targets.length}개 동기화 중…` : '노드 동기화 중…', { type: 'info', duration: 60000 });
  try {
    await Promise.all(targets.map(t => _applyNodeSync(t)));
    invalidateNodeCache(node);
    isStable = false;
    if (dismiss) dismiss();
    if (typeof paneIdx === 'number') renderPaneContent(paneIdx, node);
    if (typeof refreshOpenPanes === 'function') refreshOpenPanes();
    toast(targets.length > 1 ? `${targets.length}개 동기화됨` : '동기화됨', { type: 'success' });
  } catch (err) {
    if (dismiss) dismiss();
    toast('동기화 실패: ' + (err.message || err), { type: 'error', duration: 5000 });
  }
}

// 우측 패널 설정 메뉴 (⚙) — 노션에서 보기 / 북마크
function toggleDetailSettings(anchor, i, n, notionHref) {
  const existing = document.getElementById('detail-settings-menu');
  if (existing) { const same = existing._anchor === anchor; existing._close(); if (same) return; }
  const menu = document.createElement('div');
  menu.id = 'detail-settings-menu';
  menu.className = 'detail-settings-menu';
  const bmOn = isBookmarked(n);
  const notionItem = notionHref
    ? `<button data-act="notion"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Notion에서 보기</button>`
    : '';
  const bmItem = `<button data-act="bookmark" class="${bmOn ? 'on' : ''}"><svg width="15" height="15" viewBox="0 0 24 24" fill="${bmOn ? '#ed7000' : 'none'}" stroke="${bmOn ? '#ed7000' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> ${bmOn ? '북마크 해제' : '북마크'}</button>`;
  const trashSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  const canEdit = n.local || n.notionBlockId || (n.bodyBlocks && n.bodyBlocks.length);
  const canSync = !n.local && n.notionBlockId;
  const canAdd = typeof canAddChild === 'function' && canAddChild(n);
  const canDel = typeof canDeleteNode === 'function' && canDeleteNode(n);
  const editItem = canEdit ? `<button data-act="edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> 제목·본문 수정</button>` : '';
  const addItem = canAdd ? `<button data-act="add"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><path d="M11 7.4V13a3 3 0 0 1-3 3H7.4"/><path d="M16 18h6M19 15v6"/></svg> 하위 노드 추가</button>` : '';
  const syncItem = canSync ? `<button data-act="sync"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> 노드 동기화</button>` : '';
  const delItem = canDel ? `<button data-act="delete" class="danger">${trashSvg} 노드 삭제</button>` : '';
  const aiActItem = `<button data-act="aiact"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg> AI 작업</button>`;
  const sep = (a, b) => (a && b) ? '<div class="ds-sep"></div>' : '';
  const topGroup = editItem + addItem + syncItem;
  const midGroup = notionItem + aiActItem + bmItem;
  menu.innerHTML = topGroup + sep(topGroup, midGroup) + midGroup + sep(midGroup || topGroup, delItem) + delItem;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = 168;
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
  const close = () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('resize', close); menu.remove(); };
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  menu._anchor = anchor; menu._close = close;
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  window.addEventListener('resize', close);
  const eb = menu.querySelector('[data-act="edit"]');
  if (eb) eb.onclick = () => { close(); beginNodeEdit(i, n); };
  const ab = menu.querySelector('[data-act="add"]');
  if (ab) ab.onclick = async () => {
    close();
    try { const ids = await createChildNode(n, '(제목 없음)'); if (ids.length && nodeMap[ids[0]]) { openPanel(nodeMap[ids[0]]); beginNodeEdit(_stack.length - 1, nodeMap[ids[0]]); } }
    catch (err) { alert('하위 노드 추가 실패: ' + (err.message || err)); }
  };
  const sb = menu.querySelector('[data-act="sync"]');
  if (sb) sb.onclick = () => { close(); syncNode(n, i); };
  const nb = menu.querySelector('[data-act="notion"]');
  if (nb) nb.onclick = () => { window.open(notionHref, '_blank'); close(); };
  const bb = menu.querySelector('[data-act="bookmark"]');
  if (bb) bb.onclick = () => { toggleBookmark(n); close(); renderPaneContent(i, n); };
  const dAll = menu.querySelector('[data-act="delete"]');
  if (dAll) dAll.onclick = () => { close(); deleteNodeSmart(n); };
  const aab = menu.querySelector('[data-act="aiact"]');
  if (aab) aab.onclick = () => { close(); openAiActions([n]); };
}

// ── 토스트 알림 ───────────────────────────────────────────────────────
function toast(msg, opts) {
  opts = opts || {};
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = 'toast' + (opts.type ? ' ' + opts.type : '');
  const txt = document.createElement('span'); txt.textContent = msg; el.appendChild(txt);
  let timer;
  const dismiss = () => { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  if (opts.action) {
    const b = document.createElement('button'); b.className = 'toast-action'; b.textContent = opts.action.label;
    b.onclick = () => { try { opts.action.onClick(); } catch (e) {} dismiss(); };
    el.appendChild(b);
  }
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(dismiss, opts.duration || 3200);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1600); });
  return dismiss;
}

// ── 편집 서식: contenteditable WYSIWYG (볼드/취소선) ──────────────────
// 저장 시 마크다운(**·~~)으로 직렬화, 표시 시 HTML로 변환
function htmlFromMarkdown(t) {
  return escapeHtml(t || '')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    // [텍스트](url) → 편집기에서 원자적 링크 칩(긴 URL 숨김). href엔 원본 유지
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, txt, url) => `<a href="${url}" class="wl-ref wl-chip" contenteditable="false">${txt}</a>`);
}
function markdownFromHtml(el) {
  function walk(node) {
    let s = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') s += '\n';
        else if (tag === 'a') s += '[' + walk(c) + '](' + (c.getAttribute('href') || '') + ')';
        else if (tag === 'strong' || tag === 'b') s += '**' + walk(c) + '**';
        else if (tag === 'em' || tag === 'i') s += '*' + walk(c) + '*';
        else if (tag === 'code') s += '`' + walk(c) + '`';
        else if (tag === 'del' || tag === 's' || tag === 'strike') s += '~~' + walk(c) + '~~';
        else if (tag === 'div' || tag === 'p') s += (s && !s.endsWith('\n') ? '\n' : '') + walk(c);
        else if (tag === 'span') {
          const st = c.getAttribute('style') || '';
          let inner = walk(c);
          if (/text-decoration[^;]*line-through/.test(st)) inner = '~~' + inner + '~~';
          if (/font-style\s*:\s*italic/.test(st)) inner = '*' + inner + '*';
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
    tb.innerHTML = `<button data-cmd="bold" title="볼드 (Ctrl+B)"><b>B</b></button><button data-cmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button><button data-cmd="strikeThrough" title="취소선 (Ctrl+U)"><s>S</s></button><button data-cmd="code" title="코드 (Ctrl+E)" style="font-family:monospace;">&lt;/&gt;</button>`;
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
  if (cmd === 'code') {
    // execCommand에 code 없음 → 선택 텍스트를 <code>로 감쌈
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const text = sel.toString().replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      try { document.execCommand('insertHTML', false, `<code>${text}</code>`); } catch (e) {}
    }
    return;
  }
  // 태그 기반(<b>/<strike>)으로 강제 → 색 입힌 span 생성 방지 (취소선 해제 후 검은 글씨 버그)
  try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
  try { document.execCommand(cmd, false, null); } catch (e) {}
}
// contenteditable 요소에 서식 단축키/툴바 연결
function attachFormatting(field) {
  field.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); _fmtField = field; applyFmt('bold'); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); _fmtField = field; applyFmt('italic'); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); _fmtField = field; applyFmt('strikeThrough'); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); _fmtField = field; applyFmt('code'); }
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
// ── '[' 입력 → 헤딩 링크 자동완성 ────────────────────────────────────────
let _wikiMenu = null, _wikiItems = [], _wikiSel = 0, _wikiRow = null;
function _wikiEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _ensureWikiMenu() {
  if (_wikiMenu) return _wikiMenu;
  _wikiMenu = document.createElement('div'); _wikiMenu.id = 'wikilink-menu'; _wikiMenu.style.display = 'none';
  document.body.appendChild(_wikiMenu);
  return _wikiMenu;
}
function _hideWikiMenu() { if (_wikiMenu) _wikiMenu.style.display = 'none'; _wikiItems = []; _wikiRow = null; }
// 대상 노드의 최상위(페이지/루트) 라벨 — 동명 헤딩 구분용 맥락
function _wikiCtxLabel(n) {
  let cur = n.id, guard = 0, ctx = '';
  while (guard++ < 20) {
    const pe = edges.find(e => e.to === cur && !e.weakLink && !e.manualLink);
    if (!pe) break; cur = pe.from; const pn = nodeMap[cur]; if (!pn) break;
    ctx = pn.label; if (pn.level === 0) break;
  }
  return ctx;
}
// 캐럿 바로 앞이 '[query' 형태인지 검사 → {열림위치, 캐럿위치, query}
function _wikiQueryAtCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const node = range.startContainer;
  const pre = node.textContent.slice(0, range.startOffset);
  const m = pre.match(/\[([^\[\]\n]*)$/); // '[' 뒤 텍스트가 헤딩 자동완성 트리거
  if (!m) return null;
  return { node, start: range.startOffset - m[0].length, end: range.startOffset, query: m[1] };
}
function _renderWikiSel() {
  if (!_wikiMenu) return;
  _wikiMenu.querySelectorAll('.wl-item').forEach((el, i) => el.classList.toggle('sel', i === _wikiSel));
  const cur = _wikiMenu.querySelector('.wl-item.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function _updateWikiMenu(ce) {
  const q = _wikiQueryAtCaret();
  if (!q) { _hideWikiMenu(); return; }
  const query = q.query.trim().toLowerCase();
  let cands = nodes.filter(n => n.label && n.label.trim());
  if (query) cands = cands.filter(n => n.label.toLowerCase().includes(query));
  cands.sort((a, b) => {
    const as = a.label.toLowerCase().startsWith(query) ? 0 : 1, bs = b.label.toLowerCase().startsWith(query) ? 0 : 1;
    return as - bs || a.label.length - b.label.length;
  });
  cands = cands.slice(0, 8);
  if (!cands.length) { _hideWikiMenu(); return; }
  _wikiItems = cands; _wikiSel = 0; _wikiRow = ce;
  const menu = _ensureWikiMenu();
  menu.innerHTML = cands.map((n, i) => {
    const ctx = _wikiCtxLabel(n);
    return `<div class="wl-item${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="wl-label">${_wikiEsc(n.label)}</span>${ctx ? `<span class="wl-ctx">${_wikiEsc(ctx)}</span>` : ''}</div>`;
  }).join('');
  menu.querySelectorAll('.wl-item').forEach(el => {
    el.addEventListener('mousedown', e => { e.preventDefault(); _wikiSel = +el.dataset.i; _applyWikiSelection(); });
  });
  let rect = null;
  try { rect = window.getSelection().getRangeAt(0).getBoundingClientRect(); } catch (e) {}
  if (!rect || (!rect.left && !rect.top)) rect = ce.getBoundingClientRect();
  menu.style.display = 'block';
  const mw = menu.offsetWidth || 220;
  menu.style.left = Math.min(rect.left, window.innerWidth - mw - 8) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
}
function _applyWikiSelection() {
  const q = _wikiQueryAtCaret(), n = _wikiItems[_wikiSel];
  if (!q || !n) { _hideWikiMenu(); return; }
  const node = q.node, full = node.textContent;
  const insert = _wikiLinkText(n); // [라벨](노션URL)
  node.textContent = full.slice(0, q.start) + insert + full.slice(q.end);
  const pos = q.start + insert.length;
  const sel = window.getSelection(), range = document.createRange();
  try { range.setStart(node, pos); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); } catch (e) {}
  _hideWikiMenu();
}
function attachWikiAutocomplete(ce) {
  ce.addEventListener('input', () => _updateWikiMenu(ce));
  ce.addEventListener('keydown', e => {
    if (!_wikiMenu || _wikiMenu.style.display === 'none' || _wikiRow !== ce) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _wikiSel = Math.min(_wikiSel + 1, _wikiItems.length - 1); _renderWikiSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _wikiSel = Math.max(_wikiSel - 1, 0); _renderWikiSel(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); _applyWikiSelection(); }
    else if (e.key === 'Escape') { e.preventDefault(); _hideWikiMenu(); }
  }, true);
  ce.addEventListener('blur', () => setTimeout(_hideWikiMenu, 150));
}

// ── 본문 편집 캐럿 헬퍼(블록 간 방향키 이동·Enter 분할용) ──────────────
function _ceCaretAtStart(ce) {
  const s = window.getSelection(); if (!s || !s.rangeCount) return false;
  const r = s.getRangeAt(0); if (!r.collapsed) return false;
  const t = r.cloneRange(); t.selectNodeContents(ce); t.setEnd(r.startContainer, r.startOffset);
  return t.toString().length === 0;
}
function _ceCaretAtEnd(ce) {
  const s = window.getSelection(); if (!s || !s.rangeCount) return false;
  const r = s.getRangeAt(0); if (!r.collapsed) return false;
  const t = r.cloneRange(); t.selectNodeContents(ce); t.setStart(r.startContainer, r.startOffset);
  return t.toString().length === 0;
}
function _ceCaretRect(ce) {
  const s = window.getSelection(); if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  const rects = r.getClientRects();
  let cr = rects && rects.length ? rects[rects.length - 1] : null;
  if (!cr || (!cr.top && !cr.height)) cr = r.getBoundingClientRect();
  return cr && (cr.top || cr.height) ? cr : null;
}
function _ceCaretFirstLine(ce) { if (_ceCaretAtStart(ce)) return true; const cr = _ceCaretRect(ce); return !cr || (cr.top - ce.getBoundingClientRect().top) < 10; }
function _ceCaretLastLine(ce) { if (_ceCaretAtEnd(ce)) return true; const cr = _ceCaretRect(ce); return !cr || (ce.getBoundingClientRect().bottom - cr.bottom) < 10; }
function _focusEditRow(row, atEnd) {
  if (!row || !row.el) return;
  row.el.focus();
  const range = document.createRange(); range.selectNodeContents(row.el); range.collapse(!atEnd);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
}

async function beginNodeEdit(paneIdx, node, overrideText) {
  // 편집 시작 전, 노션 노드는 본문을 최신으로 새로고침 → 노션에서 바뀐 뒤 낡은 데이터로 저장해 꼬이는 문제 방지.
  // (AI 다듬기 등 overrideText가 주어지면 그 텍스트를 써야 하므로 새로고침하지 않음)
  if (!overrideText && node && !node.local && node.notionBlockId && typeof _applyNodeSync === 'function') {
    const dismiss = toast('최신 내용 확인 중…', { type: 'info', duration: 15000 });
    try { await _applyNodeSync(node); } catch (e) { /* 실패 시 기존 데이터로 진행 */ }
    if (dismiss) dismiss();
  }
  const paneEl = getPaneEl(paneIdx);
  if (!paneEl) return;
  const titleEl = paneEl.querySelector('.detail-title');
  const contentEl = paneEl.querySelector('.detail-content');
  const isLocal = !!node.local;
  const hasTitle = isLocal || !!node.notionBlockId;
  const hasBody = isLocal || !!(node.bodyBlocks && node.bodyBlocks.length);
  const canAdd = isLocal || !!(node.notionBlockId && node.notionParentId);
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
  let _bodyDrag = null;
  const reorderBodyRow = (dragRow, targetRow) => {
    if (dragRow === targetRow) return;
    const fi = rows.indexOf(dragRow); if (fi >= 0) rows.splice(fi, 1);
    const ti = rows.indexOf(targetRow); rows.splice(ti, 0, dragRow);
    list.insertBefore(dragRow.item, targetRow.item);
  };
  const addRow = (text, blk, afterRow) => {
    const item = document.createElement('div'); item.className = 'body-edit-item';
    const ce = document.createElement('div');
    ce.className = 'body-edit-row'; ce.contentEditable = 'true';
    ce.innerHTML = htmlFromMarkdown(text);
    if (!blk) ce.dataset.placeholder = '본문 내용…';
    const rowObj = { blk: blk || null, el: ce, item, orig: text || '', isNew: !blk };
    // 드래그 핸들 (로컬 단일 본문은 순서 불필요)
    if (!isLocal) {
      const handle = document.createElement('span'); handle.className = 'body-edit-handle'; handle.textContent = '⠿'; handle.draggable = true;
      handle.addEventListener('dragstart', e => { _bodyDrag = rowObj; item.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      handle.addEventListener('dragend', () => { item.classList.remove('dragging'); _bodyDrag = null; list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over')); });
      item.appendChild(handle);
      item.addEventListener('dragover', e => { if (_bodyDrag && _bodyDrag !== rowObj) { e.preventDefault(); item.classList.add('drag-over'); } });
      item.addEventListener('dragleave', e => { if (!item.contains(e.relatedTarget)) item.classList.remove('drag-over'); });
      item.addEventListener('drop', e => { e.preventDefault(); item.classList.remove('drag-over'); if (_bodyDrag) reorderBodyRow(_bodyDrag, rowObj); });
    }
    item.appendChild(ce);
    list.appendChild(item);
    attachFormatting(ce);
    attachWikiAutocomplete(ce); // '[' 입력 시 헤딩 자동완성
    ce.addEventListener('keydown', e => {
      const menuOpen = _wikiMenu && _wikiMenu.style.display !== 'none' && _wikiRow === ce;
      const idx = rows.indexOf(rowObj);
      // 빈 블록 백스페이스 → 삭제 후 이전 행 끝으로 (노션식)
      if (e.key === 'Backspace' && (ce.textContent || '').trim() === '') {
        if (rows.length <= 1 || idx < 0) return;
        e.preventDefault(); rows.splice(idx, 1); item.remove();
        _focusEditRow(rows[idx - 1] || rows[idx], true); return;
      }
      // Enter → 캐럿 뒤 내용을 새 블록으로 분리(아래에 추가)
      if (e.key === 'Enter' && !e.shiftKey) {
        if (menuOpen) return; // 자동완성 선택은 그쪽에서
        e.preventDefault();
        let afterMd = '';
        const s = window.getSelection();
        if (s && s.rangeCount) {
          const r = s.getRangeAt(0);
          const tail = document.createRange(); tail.selectNodeContents(ce); tail.setStart(r.endContainer, r.endOffset);
          const tmp = document.createElement('div'); tmp.appendChild(tail.extractContents());
          afterMd = markdownFromHtml(tmp);
        }
        addRow(afterMd, isLocal ? { local: true } : null, rowObj);
        _focusEditRow(rows[idx + 1], false); return;
      }
      // Shift+Enter → 같은 블록 내 소프트 줄바꿈
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      // 방향키 → 블록 경계에서 인접 블록으로 이동
      if (e.key === 'ArrowUp' && !menuOpen && _ceCaretFirstLine(ce) && idx > 0) { e.preventDefault(); _focusEditRow(rows[idx - 1], true); return; }
      if (e.key === 'ArrowDown' && !menuOpen && _ceCaretLastLine(ce) && idx < rows.length - 1) { e.preventDefault(); _focusEditRow(rows[idx + 1], false); return; }
      if (e.key === 'ArrowLeft' && _ceCaretAtStart(ce) && idx > 0) { e.preventDefault(); _focusEditRow(rows[idx - 1], true); return; }
      if (e.key === 'ArrowRight' && _ceCaretAtEnd(ce) && idx < rows.length - 1) { e.preventDefault(); _focusEditRow(rows[idx + 1], false); return; }
    });
    rows.push(rowObj);
    if (afterRow && afterRow.item && afterRow.item.parentNode === list) {
      list.insertBefore(item, afterRow.item.nextSibling);
      const cur = rows.indexOf(rowObj); if (cur >= 0) rows.splice(cur, 1);
      const ai = rows.indexOf(afterRow); rows.splice(ai + 1, 0, rowObj);
    }
    return ce;
  };
  if (typeof overrideText === 'string') {
    // AI 다듬기 등: 주어진 텍스트를 새 본문으로 로드(기존 블록은 저장 시 교체됨)
    let ol = overrideText.replace(/\s+$/, '').split('\n');
    while (ol.length && ol[0].trim() === '') ol.shift();
    if (!ol.length) ol = [''];
    ol.forEach(line => addRow(line, isLocal ? { local: true } : null));
  }
  else if (isLocal) {
    const lines = (node.desc || '').split('\n');
    if (!lines.length || (lines.length === 1 && lines[0] === '')) addRow('', { local: true });
    else lines.forEach(line => addRow(line, { local: true }));
  }
  else if (hasBody) node.bodyBlocks.forEach(blk => addRow(blk.text, blk));

  // 편집 액션바(하단 고정): [+ 본문 추가] ... [취소] [저장]
  const actions = document.createElement('div'); actions.className = 'detail-edit-actions';
  if (canAdd) {
    const addBody = document.createElement('button');
    addBody.className = 'detail-add-body-btn'; addBody.textContent = '+ 본문 추가';
    addBody.onclick = () => { addRow('', isLocal ? { local: true } : null).focus(); };
    actions.appendChild(addBody);
  }
  const spacer = document.createElement('div'); spacer.className = 'detail-edit-spacer';
  actions.appendChild(spacer);
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'detail-edit-cancel'; cancelBtn.textContent = '취소';
  const saveBtn = document.createElement('button'); saveBtn.className = 'detail-edit-save'; saveBtn.textContent = '저장';
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
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
    const reordered = !isLocal && node.notionBlockId && hasBody && (() => {
      const cur = rows.filter(r => !r.isNew).map(r => r.blk.id);
      const orig = (node.bodyBlocks || []).map(b => b.id);
      const existingReordered = cur.length === orig.length && cur.some((id, i) => id !== orig[i]);
      // 새 블록이 기존 블록들 '끝'이 아니라 중간/앞에 삽입된 경우도 위치 반영 필요(안 그러면 무조건 섹션 끝에 붙음)
      let lastExistingIdx = -1;
      rows.forEach((r, i) => { if (!r.isNew) lastExistingIdx = i; });
      const newNotAtEnd = rows.some((r, i) => r.isNew && valOf(r).trim() && i < lastExistingIdx);
      return existingReordered || newNotAtEnd;
    })();
    // 기존 본문 블록을 지운 경우(행 제거 or 내용 비움) → 저장 필요. dirty만으론 못 잡음
    const deleted = !isLocal && hasBody && (() => {
      const keptExistingIds = new Set(rows.filter(r => !r.isNew && valOf(r).trim()).map(r => r.blk.id));
      return (node.bodyBlocks || []).some(b => !keptExistingIds.has(b.id));
    })();
    if (!titleChanged && !dirty.length && !reordered && !deleted) { finish(); return; }

    const origBody = (node.bodyBlocks || []).slice();
    const oldBodyIds = origBody.map(b => b.id);
    const finalRows = rows
      .map(r => ({ blk: r.blk, isNew: r.isNew, orig: r.orig, text: valOf(r).trim() }))
      .filter(r => r.text.length); // 내용 비운 기존 블록은 삭제로 처리(빈 블록 유지 X)

    saveBtn.disabled = true; cancelBtn.disabled = true; saveBtn.textContent = '저장중…';
    try {
      if (isLocal) {
        if (titleChanged) node.label = newTitle;
        node.desc = rows.map(valOf).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
        saveLocalPages();
      } else {
        const tgt = _appendTarget(node);
        // 제목 변경 먼저 적용
        if (titleChanged) await notionUpdateBlock(node.notionBlockId, newTitle);
        // 독립적인 쓰기는 병렬로 묶어 실제 저장 시간을 줄인다
        let finalBlocks;
        if (reordered) {
          // A안: 자리 바뀐 블록만 옮김(최소 이동) + create-before-delete → 대량 블록도 안 어지럽혀짐
          finalBlocks = await _applyReorder(node, tgt, finalRows, origBody, oldBodyIds);
          node.desc = finalRows.map(r => r.text).join('\n');
        } else {
          const pre = [];
          finalRows.filter(r => r.blk && r.text !== r.orig).forEach(r => pre.push(notionUpdateBlock(r.blk.id, r.text)));
          // 편집 중 삭제된 기존 본문 블록은 노션에서도 삭제
          const keptIds = new Set(finalRows.filter(r => r.blk).map(r => r.blk.id));
          oldBodyIds.filter(id => !keptIds.has(id)).forEach(id => pre.push(notionDeleteBlock(id).catch(() => {})));
          await Promise.all(pre);
          // 새 본문은 한 번의 호출로 일괄 추가
          const newRows = finalRows.filter(r => !r.blk);
          const newIds = newRows.length ? await notionAppendBlocks(tgt.parentId, tgt.afterId, newRows.map(r => r.text), 'paragraph') : [];
          let qi = 0;
          finalBlocks = finalRows.map(r => ({ id: r.blk ? r.blk.id : newIds[qi++], text: r.text }));
          // desc는 본문 외 내용(표 등) 보존 위해 부분 치환. 단 치환 실패(orig 불일치) 시 보기 미반영 버그 → 본문 전체 재구성으로 폴백
          let d = node.desc || '', allMatched = true;
          finalRows.forEach(r => {
            if (r.blk && r.text !== r.orig && r.orig) { const nd = d.replace(r.orig, r.text); if (nd === d) allMatched = false; d = nd; }
            else if (!r.blk) d = d ? d + '\n' + r.text : r.text;
          });
          const keptIds2 = new Set(finalRows.filter(r => r.blk).map(r => r.blk.id));
          origBody.filter(b => !keptIds2.has(b.id) && b.text).forEach(b => { d = d.replace(b.text, ''); });
          node.desc = allMatched ? d.replace(/\n{3,}/g, '\n\n').trim() : finalBlocks.map(b => b.text).join('\n');
        }
        node.bodyBlocks = finalBlocks.filter(b => b.id);
        invalidateNodeCache(node);
      }
      if (titleChanged) {
        node.label = newTitle;
        refreshOpenPanes();
        if (isLocal && node.level === 0 && window._sidebarPageList) {
          const it = window._sidebarPageList.find(p => p.id === node.sourcePageId);
          if (it) { it.title = newTitle; refreshSidebarRender(); }
        }
      }
      if (typeof resolveWikiLinks === 'function') resolveWikiLinks(); // 본문 변경 → 위키링크 재해석
      isStable = false;
      finish();
      toast(isLocal ? '저장됨' : '노션에 저장됨', { type: 'success' });
    } catch (err) {
      saveBtn.disabled = false; cancelBtn.disabled = false; saveBtn.textContent = '저장';
      toast('저장 실패: ' + (err.message || err), { type: 'error', duration: 5000 });
    }
  };
}

// 이 노드에 하위 노드를 만들 수 있는가 (####/제한 노드는 false)
function canAddChild(n) {
  if (!n) return false;
  // 노드가 #### (깊이 4) 이상이면 그 아래 노드는 만들 수 없음
  if (n.local) return (n.headingDepth || 0) <= 3;
  if (n.notionBlockId && n.notionParentId && (n.headingDepth || 1) <= 3) return true;
  if (n.entryNotionId) return true;
  if (!n.notionBlockId && !n.entryNotionId && n.level === 0 && n.sourcePageId && !String(n.sourcePageId).startsWith('md_')) return true;
  return false;
}

// 하위(또는 #) 노드 생성 — 로컬은 노션 호출 없이, 노션은 append. 생성된 노드 id 배열 반환
// 새 블록을 어디에 붙일지 결정: 토글 헤딩이면 그 안(children), 일반 헤딩이면 형제로 뒤에, 페이지/엔트리면 끝에
function _appendTarget(node) {
  if (node.notionToggle && node.notionBlockId) return { parentId: node.notionBlockId, afterId: null };
  if (node.notionBlockId) return { parentId: node.notionParentId, afterId: node.notionBlockId };
  const pageLikeId = node.entryNotionId || node.sourcePageId;
  return { parentId: String(pageLikeId).replace(/-/g, ''), afterId: null };
}

// 최장 증가 부분수열(LIS)의 인덱스 목록 — 순서 유지되는 블록(제자리)을 고르는 데 사용
function _lisIndices(arr) {
  const n = arr.length; if (!n) return [];
  const tails = [], tailsIdx = [], prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = arr[i];
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x; tailsIdx[lo] = i; prev[i] = lo > 0 ? tailsIdx[lo - 1] : -1;
  }
  const res = []; let k = tailsIdx[tails.length - 1];
  while (k >= 0) { res.push(k); k = prev[k]; }
  return res.reverse();
}

// A안: 본문 블록 순서 변경 시 "실제로 자리가 바뀐 블록"만 옮긴다.
//  - 상대 순서 유지되는 최대 집합(LIS)은 그대로 둠(노션 블록 ID 보존)
//  - 나머지만 앵커(바로 앞 유지 블록) '바로 뒤'에 새로 만들고(create) 옛 복사본 삭제(delete)
//  - create-before-delete → 도중에 끊겨도 데이터 손실 없음(최악: 중복). 호출 수 최소화 → 대량 블록 안전
// 반환: 새 순서의 [{ id, text }] (bodyBlocks 용)
async function _applyReorder(node, tgt, finalRows, origBody, oldBodyIds) {
  const oldIndex = {}; origBody.forEach((b, i) => { oldIndex[b.id] = i; });
  // 유지되는(기존) 행을 새 순서로 나열 → 옛 인덱스 수열
  const keptSeq = [];
  finalRows.forEach((r, pos) => { if (r.blk && oldIndex[r.blk.id] != null) keptSeq.push({ pos, oldIdx: oldIndex[r.blk.id] }); });
  const lis = _lisIndices(keptSeq.map(k => k.oldIdx));
  const stayPos = new Set(lis.map(i => keptSeq[i].pos)); // 제자리 유지할 finalRows 위치(ID 보존)

  // 삽입 런 구성: 유지 블록(안정 앵커) 사이에 낀 이동/신규 블록 묶음 (모두 안정 앵커라 병렬 삽입 가능)
  const START = tgt.afterId || null; // 본문 첫 위치 앵커(일반 헤딩=헤딩ID / 토글·페이지=null)
  const runs = []; let cur = null, anchor = START;
  for (let pos = 0; pos < finalRows.length; pos++) {
    if (stayPos.has(pos)) { if (cur) { runs.push(cur); cur = null; } anchor = finalRows[pos].blk.id; }
    else { if (!cur) cur = { anchorId: anchor, rows: [] }; cur.rows.push({ pos, r: finalRows[pos] }); }
  }
  if (cur) runs.push(cur);

  // 맨 앞 삽입인데 앵커가 없으면(토글/페이지 직속) 정밀 이동 불가 → 안전 폴백(전부 새로 만든 뒤 옛것 삭제)
  if (runs.length && runs[0].anchorId == null) {
    const ids = finalRows.length ? await notionAppendBlocks(tgt.parentId, tgt.afterId, finalRows.map(r => r.text), 'paragraph') : [];
    await Promise.all(oldBodyIds.map(id => notionDeleteBlock(id).catch(() => {})));
    return finalRows.map((r, i) => ({ id: ids[i] || (r.blk && r.blk.id), text: r.text }));
  }

  // 1) 제자리 유지 블록의 텍스트 변경은 병렬 갱신(블록 내용 PATCH — 부모 children과 별개)
  const stayUpdates = [];
  finalRows.forEach((r, pos) => { if (stayPos.has(pos) && r.text !== r.orig) stayUpdates.push(notionUpdateBlock(r.blk.id, r.text)); });
  const updatesP = Promise.all(stayUpdates);
  // 런은 같은 부모 children 동시 쓰기 충돌을 피하려 순차 삽입(보통 1~2개)
  const newIdByPos = {};
  for (const run of runs) {
    const ids = await notionAppendBlocks(tgt.parentId, run.anchorId, run.rows.map(x => x.r.text), 'paragraph', true);
    run.rows.forEach((x, k) => { newIdByPos[x.pos] = ids[k]; });
  }
  await updatesP;

  // 2) append 성공 후에만 옛 블록 삭제(제자리 유지 제외 = 이동된 옛 복사본 + 제거된 블록)
  const stayedIds = new Set([...stayPos].map(pos => finalRows[pos].blk.id));
  await Promise.all(oldBodyIds.filter(id => !stayedIds.has(id)).map(id => notionDeleteBlock(id).catch(() => {})));

  // 3) 새 순서 + 라이브 ID로 bodyBlocks 구성
  return finalRows.map((r, pos) => stayPos.has(pos)
    ? { id: r.blk.id, text: r.text }
    : { id: newIdByPos[pos], text: r.text });
}

async function createChildNode(node, rawTitle) {
  const title = (rawTitle || '').trim().replace(/\n/g, ' ') || '(제목 없음)';
  if (node.local) {
    const newIds = _addEntryChildNodes(node, `# ${title}`);
    newIds.forEach(id => { const c = nodeMap[id]; if (c) { c.visible = true; c.local = true; c.headingDepth = (node.headingDepth || 0) + 1; } });
    saveLocalPages();
    nodes.forEach(nd => { nd._frozen = false; nd._frozenFrames = 0; });
    isStable = false;
    return [...newIds];
  }
  const isHeading = !!node.notionBlockId;
  const tgt = _appendTarget(node);
  const childDepth = isHeading ? (node.headingDepth || 1) + 1 : 1;
  const res = await notionAppendBlock(tgt.parentId, tgt.afterId, title, isHeading ? 'heading' : 'heading_1');
  if (!res || !res.id) return [];
  const snippet = `[BLOCK:${res.id}|${tgt.parentId}]\n# ${title}`;
  const newIds = _addEntryChildNodes(node, snippet);
  newIds.forEach(id => { const c = nodeMap[id]; if (c) { c.visible = true; c.headingDepth = childDepth; } });
  invalidateNodeCache(node);
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
  _autoFitPanel();
}

function openPanel(n) {
  _activeNode = n;
  const _wasOpen = detailPanel.classList.contains('open');
  // 스택에 없으면 아래(최신)에 추가, 2개 넘치면 맨 위(가장 오래된) 제거
  let added = false;
  if (!_stack.some(x => x.id === n.id)) {
    _stack.push(n);
    if (_stack.length > MAX_STACK) _stack.shift();
    added = true;
  }
  _detailPanelCollapsed = false;
  detailPanel.classList.add('open'); detailPanel.classList.remove('panel-collapsed');
  statusEl.classList.add('panel-open');
  renderPanes(added ? n.id : null);
  updateDetailReopenTab();
  if (_focusMode) {
    const shallow = _focusNodeId !== null && !n.dimmed && !isAncestorOf(n.id, _focusNodeId);
    applyFocusMode(n.id, shallow);
  }
  if (n.level === 0) {
    highlightSidebarPage(n.sourcePageId || null);
    if (_activeRailSection !== 'pages') openRailSection('pages'); // 최상위 노드 → 페이지 목록 열기
  }
  // 선택한 노드를 보이는 영역 중심으로 맞춤(패널 폭 반영해서). 패널 슬라이드 후 실행
  setTimeout(() => { try { focusViewOnNode(n); } catch (e) {} }, _wasOpen ? 40 : 320);
}

// 노드 클릭 토글: 이미 패널에 열린 노드를 다시 클릭하면 그 패널을 닫음(선택 해제)
function toggleNodePanel(n) {
  const i = _stack.findIndex(x => x.id === n.id);
  if (i >= 0) closePaneAt(i);
  else openPanel(n);
}

function closePanel() {
  _stack = []; _activeNode = null; _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  renderPanes();
  updateDetailReopenTab();
  _autoFitPanel();
}

function hidePanel() {
  if (!detailPanel.classList.contains('open')) return;
  _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  updateDetailReopenTab();
  _autoFitPanel();
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
  searchDirect.clear();
  const resultEl = document.getElementById('search-result-count');
  const resultsEl = document.getElementById('search-results');
  if (searchKeyword) {
    const directMatches = new Set();
    nodes.forEach(n => {
      if (!n.visible) return;
      const lt = n.label.toLowerCase(), dt = n.desc.toLowerCase();
      if (lt.includes(searchKeyword) || dt.includes(searchKeyword)) directMatches.add(n.id);
    });
    directMatches.forEach(id => searchDirect.add(id));
    if (resultsEl) {
      const chips = [...directMatches].map(id => nodeMap[id]).filter(Boolean).slice(0, 60);
      resultsEl.innerHTML = chips.map(n => createNodeChip(n)).join('');
      resultsEl.style.display = chips.length ? 'flex' : 'none';
    }
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
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
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
  const idArr = _subtreeIds(node.id);
  const ids = new Set(idArr);
  // 실행 취소용 스냅샷
  const undoEntry = {
    rootId: node.id, local: !!node.local, level: node.level, sourcePageId: node.sourcePageId, label: node.label,
    nodes: idArr.map(id => nodeMap[id]).filter(Boolean),
    edges: edges.filter(e => ids.has(e.from) || ids.has(e.to)),
    blockIds: []
  };
  if (!node.local) {
    // 서브트리의 모든 노션 블록(헤딩 + 본문 블록)을 삭제 — 본문은 헤딩의 형제라 따로 지워야 함
    const blockIds = [];
    idArr.forEach(id => {
      const nd = nodeMap[id]; if (!nd) return;
      if (nd.notionBlockId) blockIds.push(nd.notionBlockId);
      if (nd.bodyBlocks) nd.bodyBlocks.forEach(b => blockIds.push(b.id));
    });
    undoEntry.blockIds = blockIds;
    if (blockIds.length) {
      try { for (const bid of blockIds) { try { await notionDeleteBlock(bid); } catch (e) {} } }
      catch (err) { toast('노션 삭제 실패: ' + (err.message || err), { type: 'error', duration: 5000 }); return; }
    }
    invalidateNodeCache(node);
  }
  if (_undoDelete) _undoDelete.entries.push(undoEntry);
  nodes = nodes.filter(nd => !ids.has(nd.id));
  edges = edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
  ids.forEach(id => { delete nodeMap[id]; });
  _stack = _stack.filter(nd => !ids.has(nd.id));
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

// 이 노드만 삭제 — 하위 노드는 상위 노드로 재연결해 보존
async function deleteNodeOnly(node) {
  const id = node.id;
  const parentEdge = edges.find(e => e.to === id && !e.weakLink && !e.manualLink);
  const parentId = parentEdge ? parentEdge.from : null;
  const origTouching = edges.filter(e => e.from === id || e.to === id); // 복원용 원본 엣지 참조
  const childStructEdges = origTouching.filter(e => e.from === id && !e.weakLink && !e.manualLink);
  const addedEdges = parentId ? childStructEdges.map(ce => ({ from: parentId, to: ce.to })) : [];

  const undoEntry = {
    rootId: id, local: !!node.local, level: node.level, sourcePageId: node.sourcePageId, label: node.label,
    nodes: [node], edges: origTouching, addedEdges, blockIds: []
  };
  if (!node.local) {
    const blockIds = [];
    if (node.notionBlockId) blockIds.push(node.notionBlockId);
    if (node.bodyBlocks) node.bodyBlocks.forEach(b => blockIds.push(b.id));
    undoEntry.blockIds = blockIds;
    if (blockIds.length) {
      try { for (const bid of blockIds) { try { await notionDeleteBlock(bid); } catch (e) {} } }
      catch (err) { toast('노션 삭제 실패: ' + (err.message || err), { type: 'error', duration: 5000 }); return; }
    }
    invalidateNodeCache(node);
  }
  if (_undoDelete) _undoDelete.entries.push(undoEntry);
  // 노드와 닿는 엣지 모두 제거 후, 자식들을 상위로 재연결
  edges = edges.filter(e => e.from !== id && e.to !== id).concat(addedEdges);
  nodes = nodes.filter(nd => nd.id !== id);
  delete nodeMap[id];
  _stack = _stack.filter(nd => nd.id !== id);
  if (_activeNode && _activeNode.id === id) _activeNode = null;
  if (!anyTabs()) closePanel(); else renderPanes();
  isStable = false;
}

// 단일 진입점 — 상위가 있으면 이 노드만 삭제(하위는 상위로 이동), 루트면 하위까지 삭제
function deleteNodeSmart(node) {
  if (!node) return;
  const parentEdge = edges.find(e => e.to === node.id && !e.weakLink && !e.manualLink);
  const keep = !!parentEdge && nodeHasChildren(node);
  deleteNodeConfirm(node, keep);
}

// 노드 삭제 진입점 — keepChildren=true면 이 노드만 삭제(하위 보존)
function deleteNodeConfirm(node, keepChildren) {
  if (!node || !canDeleteNode(node)) { toast('이 노드는 삭제할 수 없어요 (페이지·DB 노드는 목록 ✕로)', { type: 'error' }); return; }
  if (keepChildren) {
    const parentEdge = edges.find(e => e.to === node.id && !e.weakLink && !e.manualLink);
    if (!parentEdge) { toast('상위 노드가 없어 이 노드만 삭제할 수 없어요', { type: 'error' }); return; }
    const childCount = edges.filter(e => e.from === node.id && !e.weakLink && !e.manualLink).length;
    const msg = `'${node.label}' 노드만 삭제할까요?\n하위 ${childCount}개는 상위 노드로 옮겨집니다.` + (!node.local ? '\n(노션에서 삭제 — 실행 취소 가능)' : '');
    showConfirm('이 노드만 삭제', msg, async () => {
      _undoDelete = { entries: [] };
      await deleteNodeOnly(node);
      if (_undoDelete.entries.length) toast('노드 삭제됨 (하위 보존)', { type: 'success', duration: 6000, action: { label: '실행 취소', onClick: undoLastDelete } });
      else _undoDelete = null;
    }, true);
  } else {
    const total = _subtreeIds(node.id).length;
    const msg = `'${node.label}' 노드(하위 포함 총 ${total}개)를 삭제할까요?` + (!node.local ? '\n(노션에서 삭제 — 실행 취소 가능)' : '');
    showConfirm('노드 삭제', msg, async () => {
      _undoDelete = { entries: [] };
      await deleteNodeSubtree(node);
      const cnt = _undoDelete.entries.length;
      if (cnt) toast(`${cnt}개 노드 삭제됨`, { type: 'success', duration: 6000, action: { label: '실행 취소', onClick: undoLastDelete } });
      else _undoDelete = null;
    }, true);
  }
}

// 마지막 삭제 묶음 복원 (그래프 + 노션 블록 un-archive + 캐시)
async function undoLastDelete() {
  if (!_undoDelete || !_undoDelete.entries.length) return;
  const entries = _undoDelete.entries.slice();
  _undoDelete = null;
  let anyLocal = false, notionFail = 0;
  for (const e of entries) {
    // 이 노드만 삭제로 추가됐던 재연결 엣지 제거 (원본 구조 복원 전에)
    if (e.addedEdges && e.addedEdges.length) edges = edges.filter(ed => !e.addedEdges.includes(ed));
    e.nodes.forEach(nd => { if (!nodeMap[nd.id]) { nodes.push(nd); nodeMap[nd.id] = nd; } nd.visible = true; });
    e.edges.forEach(ed => { if (!edges.includes(ed)) edges.push(ed); });
    if (e.blockIds && e.blockIds.length) {
      // 부모(헤딩)부터 복원되도록 역순(자식 먼저 삭제됐던 순서의 반대)
      for (let i = e.blockIds.length - 1; i >= 0; i--) {
        try { await notionRestoreBlock(e.blockIds[i]); } catch (err) { notionFail++; }
      }
    }
    // 복원된 노드가 속한 페이지 캐시 무효화 → 새로고침해도 살아난 블록 반영
    if (e.nodes && e.nodes[0]) invalidateNodeCache(e.nodes[0]);
    if (e.local) {
      anyLocal = true;
      if (e.level === 0) {
        _addedPageIds.add(e.sourcePageId);
        if (typeof _registerLocalInList === 'function') _registerLocalInList(e.sourcePageId, e.label || '새 노드');
      }
    }
  }
  if (anyLocal) saveLocalPages();
  if (typeof refreshSidebarRender === 'function') refreshSidebarRender();
  isStable = false;
  if (notionFail) toast('일부 노션 블록 복원 실패 (' + notionFail + '개)', { type: 'error', duration: 5000 });
  else toast('삭제 취소됨', { type: 'success' });
}
canvas.addEventListener('mousemove', e => {
  if (_rotating) {
    const dy = e.clientY - _rotStartY;
    if (Math.abs(dy) > 2) { _rotMoved = true; canvas.style.cursor = 'ns-resize'; }
    let deg = (_rotStartAngle + dy * 0.005) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 45) * 45; // Shift → 45° 스냅
    setViewRotation(deg); return;
  }
  if (drag) {
    const w = screenToWorld(e.clientX, e.clientY); drag.x = w.x; drag.y = w.y;
    nodes.forEach(n => { if (n._frozen && dist(n, drag) < 200) { n._frozen = false; n._frozenFrames = 0; } });
    { const q = [drag.id], seen = new Set([drag.id]); while (q.length) { const id = q.shift(); edges.forEach(e => { if (e.from === id && !e.weakLink && !seen.has(e.to)) { seen.add(e.to); const c = nodeMap[e.to]; if (c) { if (c._frozen) { c._frozen = false; c._frozenFrames = 0; } q.push(e.to); } } }); } }
    return;
  }
  if (isPanning) { panX = panStartOffsetX + (e.clientX - panStartX); panY = panStartOffsetY + (e.clientY - panStartY); return; }
  const n = getNodeAt(e.clientX, e.clientY);
  hoveredNode = n;
  if (!_multiSelectMode) canvas.style.cursor = n ? 'pointer' : 'default';
  if (n && n.level > 0) {
    tooltip.textContent = n.label; tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY - 32) + 'px';
  } else { tooltip.style.display = 'none'; }
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) {
    // 빈 공간 우클릭 상하 드래그 → 화면 회전. 노드 위 우클릭은 선택(contextmenu)
    if (!getNodeAt(e.clientX, e.clientY)) { _rotating = true; _rotMoved = false; _rotStartY = e.clientY; _rotStartAngle = _viewRotation; }
    e.preventDefault(); return;
  }
  mouseDownTime = Date.now();
  const n = getNodeAt(e.clientX, e.clientY);
  mouseDownNode = n;
  if (n) { drag = n; isStable = false; }
  else { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; panStartOffsetX = panX; panStartOffsetY = panY; canvas.style.cursor = 'grab'; }
});

let _clickTimer = null;

canvas.addEventListener('mouseup', e => {
  if (_rotating) { _rotating = false; canvas.style.cursor = ''; if (_rotMoved) _suppressContext = true; return; }
  if (e.button === 2) return; // 우클릭은 contextmenu에서 처리
  const elapsed = Date.now() - mouseDownTime;
  const n = getNodeAt(e.clientX, e.clientY);
  if (elapsed < 150 && n && n === mouseDownNode && n.level > 0 && _connectMode) {
    handleConnectClick(n);
  } else if (elapsed < 150 && n && n === mouseDownNode && (e.ctrlKey || e.metaKey)) {
    // Ctrl/⌘+클릭 → 노드 고정/해제
    clearTimeout(_clickTimer);
    n.fixed = !n.fixed;
    if (!n.fixed) { n.vx = 0; n.vy = 0; }
    unfreezeSubtree(n); saveFixedPositions(); isStable = false;
  } else if (elapsed < 150 && n && n === mouseDownNode && _multiSelectMode) {
    toggleMultiSelect(n);
  } else if (elapsed < 150 && n && n === mouseDownNode) {
    clearTimeout(_clickTimer); _clickTimer = setTimeout(() => toggleNodePanel(n), 220);
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

canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hoveredNode = null; drag = null; isPanning = false; if (_rotating) { _rotating = false; canvas.style.cursor = ''; } });

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
  if (!n) { fitGraph(true); return; } // 빈 공간 더블클릭 → 화면 맞춤
  if (_pcSelectGesture !== 'dblclick') return; // 우클릭 모드면 노드 더블클릭은 무시(단일클릭이 패널 염)
  // 더블클릭 → 선택에 추가 (기존 선택 유지, 여러 개 누적 가능)
  if (!_multiSelected.includes(n)) toggleMultiSelect(n);
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (_suppressContext) { _suppressContext = false; return; } // 방금 빈 곳 우클릭 드래그(회전)였음 — 메뉴/선택 안 함
  // 우클릭 → 노드 위면 선택(누적)하고 종료
  if (_pcSelectGesture === 'rightclick') {
    const node = getNodeAt(e.clientX, e.clientY);
    if (node) { if (!_multiSelected.includes(node)) toggleMultiSelect(node); return; }
  }
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
  const wpt = screenToWorld(mx, my);
  scale = Math.max(0.15, Math.min(4, scale * factor));
  const c = Math.cos(_viewRotation), s = Math.sin(_viewRotation);
  const dx = wpt.x - W / 2, dy = wpt.y - H / 2;
  panX = mx - W / 2 - (dx * c - dy * s) * scale;
  panY = my - H / 2 - (dx * s + dy * c) * scale;
  showViewStatus();
}, { passive: false });

// ── 터치 지원 (모바일 팬/탭 + 핀치 줌) ─────────────────────────────────

let _touchMode = null, _touchMoved = false, _touchStartX = 0, _touchStartY = 0;
let _pinchStartDist = 0, _pinchStartScale = 1, _pinchStartAngle = 0, _pinchStartRotation = 0;
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
    _pinchStartAngle = Math.atan2(dy, dx); _pinchStartRotation = _viewRotation;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (_touchMode === 'pinch' && e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
    const pinchDist = Math.sqrt(dx*dx + dy*dy);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2, midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const wpt = screenToWorld(midX, midY); // 회전·확대 적용 전 중점의 월드 좌표
    scale = Math.max(0.15, Math.min(4, _pinchStartScale * (pinchDist / _pinchStartDist)));
    // 두 손가락 회전 → 화면 회전
    setViewRotation((_pinchStartRotation + (Math.atan2(dy, dx) - _pinchStartAngle)) * 180 / Math.PI);
    // 중점이 그대로 손가락 사이에 있도록 팬 재계산
    const c = Math.cos(_viewRotation), s = Math.sin(_viewRotation);
    const ddx = wpt.x - W / 2, ddy = wpt.y - H / 2;
    panX = midX - W / 2 - (ddx * c - ddy * s) * scale;
    panY = midY - H / 2 - (ddx * s + ddy * c) * scale;
    showViewStatus();
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
    } else if (elapsed < 300 && n && _multiSelectMode) {
      toggleMultiSelect(n);
    } else if (elapsed < 300 && n) {
      const now = Date.now();
      if (_lastTapNode === n && now - _lastTapTime < 350) {
        // 더블탭 → 선택에 추가 (기존 선택 유지)
        clearTimeout(_clickTimer);
        if (!_multiSelected.includes(n)) toggleMultiSelect(n);
        _lastTapNode = null; _lastTapTime = 0;
      } else {
        clearTimeout(_clickTimer); _clickTimer = setTimeout(() => toggleNodePanel(n), 220);
        _lastTapNode = n; _lastTapTime = now;
      }
    } else if (elapsed < 300 && !n) {
      const now = Date.now();
      if (_lastTapNode === null && _lastTapTime && now - _lastTapTime < 350) {
        // 빈 공간 더블탭 → 화면 맞춤(회전 포함)
        fitGraph(true);
        _lastTapTime = 0;
      } else {
        clearAllModes();
        _lastTapNode = null; _lastTapTime = now;
      }
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
  const dw = localStorage.getItem('snlog_detail_w');
  if (dw) document.documentElement.style.setProperty('--detail-w', dw + 'px');
})();

(function setupPanelResize() {
  const dH = document.getElementById('detail-resize-handle');
  if (!dH) return;
  let active = false;
  function onMove(clientX) {
    if (!active) return;
    const w = Math.max(280, Math.min(720, window.innerWidth - clientX - 12));
    document.documentElement.style.setProperty('--detail-w', w + 'px');
  }
  function start(e) { active = true; e.preventDefault(); document.body.classList.add('resizing-panel'); dH.classList.add('dragging'); }
  function end() {
    if (!active) return;
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--detail-w'));
    if (v) localStorage.setItem('snlog_detail_w', v);
    document.body.classList.remove('resizing-panel'); dH.classList.remove('dragging'); active = false;
    try { fitGraph(); } catch (e) {} // 폭 바뀐 만큼 화면 맞춤
  }
  dH.addEventListener('mousedown', start);
  window.addEventListener('mousemove', e => onMove(e.clientX));
  window.addEventListener('mouseup', end);
  dH.addEventListener('touchstart', start, { passive: false });
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
    's-api':'Notion API 토큰','sc-save':'저장','sc-placeholder-token':'새 토큰 입력...',
    's-aikey':'AI API 키','s-aikey-sub':'Google AI Studio 제미나이 키. 선택 노드 요약·마크다운 작성에 사용.','s-aikey-ph':'AIza...',
    's-imgsize':'이미지 저장 크기',
    's-shortcuts':'키보드 단축키','s-shortcuts-hint':'버튼 클릭 후 원하는 키 입력',
    'sc-lbl':'제목 표시','sc-lbl-sub':'제목 표시 / 그래프',
    'sc-focus':'포커스 모드','sc-focus-sub':'선택 노드만 표시',
    'sc-connect':'연결 모드','sc-connect-sub':'노드 수동 연결',
    'sc-multiselectmode':'노드 선택 모드','sc-multiselectmode-sub':'노드 클릭하여 편집·탐색 메뉴 열기',
    'sc-fit':'화면 맞춤','sc-fit-sub':'전체 화면 맞춤',
    'sc-hide':'패널 숨기기','sc-hide-sub':'Esc (고정)',
    'sc-pin':'노드 고정 / 해제','sc-pin-sub':'Ctrl+클릭으로 고정','sc-dblclick':'Ctrl+클릭',
    'sc-multiselect':'노드 선택','sc-multiselect-sub':'연결 / 경로찾기 / 위성 / 고정','sc-shiftclick':'더블클릭',
    'lbl-collapse-all':'토글 전체 접기','lbl-nodecolor':'노드 색상','cs-node-btn':'노드별','cs-depth-btn':'깊이별','lbl-nodemode':'노드 모드','lbl-graphset':'그래프 설정','lbl-showconn':'노드 연결 표시','lbl-showlabels':'제목 표시','lbl-layout':'그래프 배치','lm-force-btn':'힘기반','lm-radial-btn':'방사형','lm-cluster-btn':'페이지별','lbl-page':'페이지','lbl-title-size':'제목 크기','lbl-rotation':'화면 회전',
    'rail-pages':'페이지 목록','rail-search':'검색','rail-nodemode':'노드 모드','rail-graphcfg':'그래프 설정','rail-aichat':'AI 대화',
    'ai-chat':'AI 대화','ai-chat-hint':'노드 기반 AI 대화','ai-chat-ph':'키워드 입력하여 AI와 대화 시작',
    'sc-sel-sub':'노드 우클릭 (모바일: 더블탭)','sc-rightclick':'우클릭','sc-fit-sub2':'스페이스바 · 빈 공간 더블클릭 / 더블탭','sc-dblclick2':'Space · 더블클릭','sc-rotate':'화면 회전','sc-rotate-sub':'빈 공간 우클릭 상하 드래그 (모바일: 두 손가락)','sc-rotate-key':'우클릭 드래그',
    's-local-warn':'⚠ API 토큰이 이 기기의 브라우저에 저장됩니다. 공용 컴퓨터에서는 사용을 권장하지 않습니다.',
    's-storage':'저장 & 캐시','s-local':'로컬 저장 사용','s-local-sub':'⚠ 로컬 저장시 토큰이 브라우저에 저장. 공용 기기 주의.',
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
    's-api':'Notion API Token','sc-save':'Save','sc-placeholder-token':'Enter new token...',
    's-aikey':'AI API Key','s-aikey-sub':'Google AI Studio Gemini key. Used for summarizing selected nodes & writing markdown.','s-aikey-ph':'AIza...',
    's-imgsize':'Export Image Size',
    's-shortcuts':'Keyboard Shortcuts','s-shortcuts-hint':'Click a button, then press a key',
    'sc-lbl':'Toggle Labels','sc-lbl-sub':'Show/hide node labels',
    'sc-focus':'Focus Mode','sc-focus-sub':'Show selected node only',
    'sc-connect':'Connect Mode','sc-connect-sub':'Connect nodes manually',
    'sc-multiselectmode':'Node Select Mode','sc-multiselectmode-sub':'Click nodes to open edit/explore menu',
    'sc-fit':'Fit to View','sc-fit-sub':'Fit graph to screen',
    'sc-hide':'Hide Panel','sc-hide-sub':'Esc (fixed)',
    'sc-pin':'Pin / Unpin Node','sc-pin-sub':'Ctrl+Click to pin','sc-dblclick':'Ctrl+Click',
    'sc-multiselect':'Select Node','sc-multiselect-sub':'Connect / Path / Satellite / Pin','sc-shiftclick':'Double-click',
    'lbl-collapse-all':'Collapse All Toggles','lbl-nodecolor':'Node Color','cs-node-btn':'Per-node','cs-depth-btn':'By depth','lbl-nodemode':'Node Mode','lbl-graphset':'Graph Settings','lbl-showconn':'Show Connections','lbl-showlabels':'Show Titles','lbl-layout':'Layout','lm-force-btn':'Force','lm-radial-btn':'Radial','lm-cluster-btn':'By page','lbl-page':'Page','lbl-title-size':'Title Size','lbl-rotation':'View Rotation',
    'rail-pages':'Page List','rail-search':'Search','rail-nodemode':'Node Mode','rail-graphcfg':'Graph Settings','rail-aichat':'AI Chat',
    'ai-chat':'AI Chat','ai-chat-hint':'Node-based AI chat','ai-chat-ph':'Type a keyword to chat with AI',
    'sc-sel-sub':'Right-click node (mobile: double-tap)','sc-rightclick':'Right-click','sc-fit-sub2':'Spacebar · double-click empty space / double-tap','sc-dblclick2':'Space · Double-click','sc-rotate':'View Rotation','sc-rotate-sub':'Right-drag empty space up/down (mobile: two fingers)','sc-rotate-key':'Right-drag',
    's-local-warn':'⚠ API token is stored in this browser. Not recommended on shared computers.',
    's-storage':'Storage & Cache','s-local':'Use Local Storage','s-local-sub':'⚠ API token is stored in this device\'s browser. Not recommended on shared devices.',
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

const DEFAULT_SHORTCUTS = { toggleLabels: 't' };
let _shortcuts = (() => { try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('snlog_shortcuts') || '{}') }; } catch(e) { return { ...DEFAULT_SHORTCUTS }; } })();
// 구버전 단축키 정리 (편집/탐색 모드 통합 → 노드 선택 모드 하나, N 키)
delete _shortcuts.toggleFocusMode; delete _shortcuts.toggleConnectMode; delete _shortcuts.toggleEditMode; delete _shortcuts.toggleMultiSelectMode;
function saveShortcuts() { localStorage.setItem('snlog_shortcuts', JSON.stringify(_shortcuts)); }
function formatKey(k) { return k === ' ' ? 'Space' : k.toUpperCase(); }
function updateShortcutHints() {
  ['toggleLabels'].forEach(action => {
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
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.length === 1) { _shortcuts[_recordingFor] = k; saveShortcuts(); updateShortcutHints(); _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(k); _recordingFor = null; _recordingBtn = null; }
    return;
  }
  if (e.key === 'Escape') {
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (_activeRailSection) { closeRailFlyout(); return; }
    if (detailPanel.classList.contains('open')) { hidePanel(); return; }
    return;
  }
  const tag = document.activeElement?.tagName;
  // 입력란이나 본문 편집(contenteditable) 중이면 단축키 무시 — 1, 2 등 글자 입력 보장
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === _shortcuts.toggleLabels) { e.preventDefault(); const cb = document.getElementById('label-toggle-input'); if (cb) cb.checked = !cb.checked; toggleLabels(); }
  else if (e.key === ' ') { e.preventDefault(); fitGraph(true); } // 스페이스바 → 화면 맞춤
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

  // 저장된 키 표시(마스킹) — 넣었는지 눈으로 확인 가능하게
  const tIn = document.getElementById('settings-token-input');
  if (tIn) { tIn.value = ''; tIn.placeholder = _savedToken ? 'Notion API 저장됨' : (t('sc-placeholder-token') || '새 토큰 입력...'); }
  const aIn = document.getElementById('settings-aikey-input');
  if (aIn) { aIn.value = ''; aIn.placeholder = _savedAiKey ? 'AI API 저장됨' : 'AIza...'; }

  const localToggle = document.getElementById('s-local-toggle');
  if (localToggle) localToggle.checked = _useLocalStorage;
  const warn = document.getElementById('s-local-warn');
  if (warn) warn.style.display = _useLocalStorage ? 'block' : 'none';

  ['pages'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) el.checked = _storageScopes[k] !== false; });
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', _exportSize === s); });
  ['toggleLabels'].forEach(action => { const btn = document.getElementById('sc-' + action); if (btn) btn.textContent = formatKey(_shortcuts[action]); });
  ['ko','en'].forEach(l => { document.getElementById('lang-btn-' + l)?.classList.toggle('active', _lang === l); });

  ['shortcuts'].forEach(id => {
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
  if (_useLocalStorage) { if (_savedToken) localStorage.setItem('snlog_token', _savedToken); if (_savedAiKey) localStorage.setItem('snlog_ai_key', _savedAiKey); }
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
  if (input) { input.value = ''; input.placeholder = 'Notion API 저장됨'; }
  if (msg) { msg.textContent = '저장됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  loadProfile();
}

function updateAiKey() {
  const input = document.getElementById('settings-aikey-input'), msg = document.getElementById('settings-aikey-msg');
  const val = input?.value.trim();
  if (!val) { if (msg) { msg.textContent = 'API 키를 입력해주세요'; msg.style.display = 'block'; } return; }
  _savedAiKey = val;
  sessionStorage.setItem('snlog_ai_key', val);
  if (_useLocalStorage) localStorage.setItem('snlog_ai_key', val);
  if (input) { input.value = ''; input.placeholder = 'AI API 저장됨'; }
  if (msg) { msg.textContent = '저장됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
}

function setExportSize(size) {
  _exportSize = size;
  localStorage.setItem('snlog_export_size', size);
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', s === size); });
}

function clearCache(type) {
  const allKeys = [...Object.keys(sessionStorage), ...Object.keys(localStorage)];
  if (type === 'pages' || type === 'all') {
    allKeys.filter(k => k.startsWith('snlog_') && !['snlog_token','snlog_ai_key','snlog_pages','snlog_manual_links','snlog_use_local','snlog_scopes','snlog_export_size','snlog_slider','snlog_search_history'].includes(k))
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
setColorScheme(_colorScheme); // 저장된 색상 표현으로 UI 동기화
syncLayoutButtons(); // 저장된 배치 모드로 버튼 동기화
(() => { const cb = document.getElementById('conn-toggle-input'); if (cb) cb.checked = _showConnections; })(); // 노드 연결 표시 토글 동기화
(() => { const sl = document.getElementById('cfg-label-scale'); if (sl) sl.value = _labelScale; setLabelScale(_labelScale); })();
(() => {
  const deg = Math.round(_viewRotation * 180 / Math.PI);
  const sl = document.getElementById('cfg-rotation'); if (sl) sl.value = deg;
  const out = document.getElementById('rotation-val'); if (out) out.textContent = deg + '°';
})();
renderPanes();
applyLegendState();

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
