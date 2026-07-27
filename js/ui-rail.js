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
  if (name === 'search') {
    setTimeout(() => document.getElementById('search-input')?.focus(), 60);
    if (typeof renderSearchHistory === 'function') renderSearchHistory();
    if (typeof renderPopularKeywords === 'function') renderPopularKeywords();
    if (typeof renderFrequentKeywords === 'function') renderFrequentKeywords();
  }
  if (name === 'aichat') { setTimeout(() => document.getElementById('aichat-input')?.focus(), 60); if (typeof _renderAiChat === 'function') _renderAiChat(); }
  if (name === 'bookmarks') { renderBookmarkList(); renderInsights(); }
  applyRailSecState(); // 정적 마크업(노드 모드·그래프 설정)에 저장된 접힘 상태 반영
}

// ── 레일 섹션 접기/펼치기 (기본 열림, 선택은 localStorage 유지) ──────
let _railOpen = (() => { try { return JSON.parse(localStorage.getItem('snlog_rail_open') || '{}'); } catch (e) { return {}; } })();
function isRailSecOpen(key) { return _railOpen[key] !== false; }
function toggleRailSec(key) {
  _railOpen[key] = !isRailSecOpen(key);
  try { localStorage.setItem('snlog_rail_open', JSON.stringify(_railOpen)); } catch (e) {}
  applyRailSecState();
}
// 머리글·본문 모두 data-sec를 달아두고 closed 클래스만 토글 (재렌더 불필요)
function applyRailSecState() {
  document.querySelectorAll('#sidebar [data-sec]').forEach(el => {
    el.classList.toggle('closed', !isRailSecOpen(el.dataset.sec));
  });
}
const _RAIL_CARET = `<svg class="rail-sec-caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
// 접히는 소제목 머리글 (JS로 그리는 레일 섹션용)
function railSecHead(key, label, extraCls) {
  const cls = 'rail-subhead rail-sec-head' + (extraCls ? ' ' + extraCls : '') + (isRailSecOpen(key) ? '' : ' closed');
  return `<button type="button" class="${cls}" data-sec="${key}" onclick="toggleRailSec('${key}')">${_RAIL_CARET}${label}</button>`;
}
function railSecBody(key, inner) {
  return `<div class="rail-secbody${isRailSecOpen(key) ? '' : ' closed'}" data-sec="${key}">${inner}</div>`;
}

// 북마크한 노드 목록 (레일 섹션) — 클릭 시 그 노드로 이동 + 패널 열기
// 노드 섹션: 북마크 + 최근 본 노드
let _recentNodes = [];
function renderBookmarkList() {
  const el = document.getElementById('bookmark-list');
  if (!el) return;
  const bmIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#ed7000" stroke="#ed7000" stroke-width="1.5" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  const clockIc = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`;
  const xIc = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const rowHtml = (n, ic, del) => {
    const t = escapeHtml((n.label || '(제목 없음)').trim());
    return `<div class="bm-item" data-nid="${n.id}" title="${t}"><span class="bm-ic">${ic}</span><span class="bm-label">${t}</span>`
      + (del ? `<button class="bm-x" onclick="event.stopPropagation();removeRecentNode('${n.id}')" title="목록에서 제거" aria-label="목록에서 제거">${xIc}</button>` : '')
      + `</div>`;
  };
  const bms = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && isBookmarked(n));
  const recents = (typeof _recentNodes !== 'undefined' ? _recentNodes : []).map(id => nodeMap[id]).filter(n => n && n.visible);
  let html = railSecHead('bm', '북마크');
  html += railSecBody('bm', bms.length ? bms.map(n => rowHtml(n, bmIcon)).join('')
    : `<div class="rail-empty">북마크 노드 모음</div>`);
  const freq = _frequentNodes(8);
  html += railSecHead('freq', '자주 본 노드', 'mt');
  html += railSecBody('freq', freq.length
    ? freq.map(f => rowHtml(f.n, `<span class="bm-count">${f.c}</span>`)).join('')
    : `<div class="rail-empty">2번 이상 선택된 노드</div>`);
  html += railSecHead('recent', '최근 본 노드', 'mt');
  html += railSecBody('recent', recents.length ? recents.map(n => rowHtml(n, clockIc, true)).join('')
    : `<div class="rail-empty">클릭한 노드 기록</div>`);
  el.innerHTML = html;
  el.querySelectorAll('.bm-item').forEach(row => {
    row.onclick = () => {
      const n = nodeMap[row.dataset.nid];
      if (!n) return;
      openPanel(n);
      if (typeof focusViewOnNode === 'function') focusViewOnNode(n);
    };
  });
}
// ── 자주 본 노드 — 조회 횟수 누적 (노드 id는 재로드마다 바뀌므로 안정 키로 저장) ──
let _nodeViews = (() => { try { return JSON.parse(localStorage.getItem('snlog_node_views') || '{}'); } catch (e) { return {}; } })();
function bumpNodeView(n) {
  const k = _stableNodeKey(n);
  if (!k || k === '::') return;
  _nodeViews[k] = (_nodeViews[k] || 0) + 1;
  try { localStorage.setItem('snlog_node_views', JSON.stringify(_nodeViews)); } catch (e) {}
}
// 2회 이상 본 노드를 많이 본 순으로 (현재 그래프에 있는 것만)
function _frequentNodes(topN) {
  const out = [];
  (typeof nodes !== 'undefined' ? nodes : []).forEach(n => {
    if (!n.visible || n._aiSummary) return;
    const c = _nodeViews[_stableNodeKey(n)] || 0;
    if (c >= 2) out.push({ n, c });
  });
  return out.sort((a, b) => b.c - a.c).slice(0, topN);
}

// 최근 본 노드 목록에서 항목 하나 제거 (메모리에만 있는 기록이라 목록만 갱신)
function removeRecentNode(id) {
  _recentNodes = _recentNodes.filter(x => x !== id);
  renderBookmarkList();
}

function closeRailFlyout() {
  if (!_activeRailSection) return;
  _activeRailSection = null;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
  _railSections.forEach(k => { const b = document.getElementById('rail-' + k); if (b) b.classList.remove('active'); });
}

// ── 통찰(Insight) : "적히지 않은 관계"를 계산해서 제안 (노드 탭에 병합) ──────
// 중심(허브)·연결 제안 모두 순수 그래프/키워드 계산 (AI·토큰 0).
let _linkSuggestCache = null;
let _dismissedPairs = new Set(); // 거절한 쌍 — 안정 키(sourcePageId::label)로 저장(노드 id는 재로드/동기화마다 바뀌므로 쓰면 안 됨)
function _stableNodeKey(n) { return `${(n && n.sourcePageId) || ''}::${((n && n.label) || '').trim()}`; }
function _pairKey(a, b) { return [_stableNodeKey(a), _stableNodeKey(b)].sort().join('§§'); }
function _saveDismissed() {
  if (!_useLocalStorage) return;
  try { localStorage.setItem('snlog_dismissed_pairs_v2', JSON.stringify([..._dismissedPairs])); } catch (e) {}
}
(function _restoreDismissed() {
  try { if (!_useLocalStorage) return; const s = localStorage.getItem('snlog_dismissed_pairs_v2'); if (s) JSON.parse(s).forEach(k => _dismissedPairs.add(k)); } catch (e) {}
})();


// 중심 노드 = 문서의 뼈대 — 페이지(최상위) + 헤딩1. 연결 수가 아니라 구조로 뽑는다.
// 각 항목의 하위 노드 개수를 함께 반환(뱃지 표시용).
function _computeHubs(topN) {
  const vis = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && !n._aiSummary);
  // 단일 하위 페이지 + DB 내부 페이지만. (최상위 페이지·데이터베이스 제목은 제외)
  // 둘 다 노션 페이지라 entryNotionId를 가짐 — 최상위(level 0)·DB 제목(isDbNode)은 안 가짐.
  const scored = vis.filter(n => !!n.entryNotionId).map(n => ({ n, deg: _descendantIds(n.id).length }));
  scored.sort((a, b) => b.deg - a.deg); // 하위 많은 순
  return scored.slice(0, topN);
}

// 구조적 하위 노드 전체(손자 이하 포함) — 약한/수동 링크는 계층이 아니므로 제외
function _descendantIds(rootId) {
  const out = [], seen = new Set([rootId]), q = [rootId];
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => {
      if (e.from === id && !e.weakLink && !e.manualLink && !seen.has(e.to)) {
        seen.add(e.to); out.push(e.to); q.push(e.to);
      }
    });
  }
  return out;
}

// 중심 노드 클릭 → 자기 자신 + 모든 하위 노드를 그래프에서 활성화
function insightFocusBranch(nid) {
  const n = nodeMap[nid];
  if (!n) return;
  const ids = [nid, ..._descendantIds(nid)];
  if (typeof applyGraphHighlight === 'function') {
    applyGraphHighlight(ids, '', { max: 20, fit: true, fitDelay: 320 }); // 마커=본문에 없는 문자
  }
}

// 제목 → 의미 토큰 집합(불용어·순수숫자 제외, 한글 어간 처리). _aiTerms 재활용.
function _titleTokens(label) {
  const set = new Set();
  _aiTerms(label || '').forEach(variants => { const t = variants[0]; if (t && t.length >= 2 && !/^\d+$/.test(t)) set.add(t); });
  return set;
}

// 연결 제안: 제목 키워드 겹침(공통 토큰 수 + Jaccard) → 아직 안 이어진 유사 노드쌍. API 없이 순수 계산(토큰 0).
function _computeLinkSuggestions(topN) {
  const vis = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && !n._aiSummary && n.label && n.label.trim());
  const toks = vis.map(n => ({ n, t: _titleTokens(n.label) })).filter(x => x.t.size);
  const connected = new Set();
  edges.forEach(e => { connected.add(e.from + '|' + e.to); connected.add(e.to + '|' + e.from); });
  const pairs = [];
  for (let i = 0; i < toks.length; i++) {
    const A = toks[i];
    for (let j = i + 1; j < toks.length; j++) {
      const B = toks[j];
      if (connected.has(A.n.id + '|' + B.n.id)) continue;
      if (_dismissedPairs.has(_pairKey(A.n, B.n))) continue; // 거절한 쌍 제외
      if (_titleKey(A.n.label) === _titleKey(B.n.label)) continue;
      let shared = 0; const terms = [];
      A.t.forEach(t => { if (B.t.has(t)) { shared++; terms.push(t); } });
      if (!shared) continue;
      const union = A.t.size + B.t.size - shared;
      const jac = union ? shared / union : 0;
      if (shared < 2 && jac < 0.34) continue; // 공통 1개는 겹침 비율이 높을 때만
      pairs.push({ a: A.n, b: B.n, shared, terms, s: jac });
    }
  }
  pairs.sort((x, y) => (y.shared - x.shared) || (y.s - x.s));
  const out = [], used = {};
  for (const p of pairs) {
    if ((used[p.a.id] || 0) >= 2 || (used[p.b.id] || 0) >= 2) continue; // 한 노드가 목록을 독점하지 않게
    out.push(p); used[p.a.id] = (used[p.a.id] || 0) + 1; used[p.b.id] = (used[p.b.id] || 0) + 1;
    if (out.length >= topN) break;
  }
  return out;
}

function renderInsights() {
  const el = document.getElementById('insight-body');
  if (!el) return;
  const hubs = _computeHubs(10);

  let html = '';
  // 중심 노드 (연결 3개 초과, 최대 10)
  html += `<div class="insight-sec">` + railSecHead('hubs', '중심 노드', 'mt');
  const hubChip = h => `<span class="insight-chipwrap hub-item" onclick="insightFocusBranch('${h.n.id}')" title="${escapeHtml((h.n.label || '').trim())} — 하위 ${h.deg}개 활성화">${createNodeChip(h.n)}<span class="insight-badge">${h.deg}</span></span>`;
  html += railSecBody('hubs', hubs.length
    ? `<div class="insight-chips">${hubs.map(hubChip).join('')}</div>`
    : `<div class="rail-empty">페이지 없음</div>`);
  html += `</div>`;

  // 연결 제안 (제목 키워드 겹침 · 토큰 0 · 최대 5)
  _linkSuggestCache = _computeLinkSuggestions(5);
  html += `<div class="insight-sec">` + railSecHead('suggest', '연결 제안', 'mt');
  html += railSecBody('suggest', `<div id="insight-suggest-body">` + _renderSuggestHtml(_linkSuggestCache) + `</div>`) + `</div>`;

  el.innerHTML = html;
}

function _renderSuggestHtml(list) {
  list = (list || []).filter(p => nodeMap[p.a.id] && nodeMap[p.b.id]);
  if (!list.length) return `<div class="rail-empty">이을 만한 노드 없음</div>`;
  const biIc = `<svg width="17" height="12" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="8" x2="20" y2="8"/><polyline points="7.5 4 3.5 8 7.5 12"/><polyline points="16.5 4 20.5 8 16.5 12"/></svg>`;
  const zoomIc = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>`;
  const closeIc = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  return list.map((p, i) => {
    const terms = (p.terms || []).slice(0, 3).join(', ');
    const la = escapeHtml((p.a.label || '').trim()), lb = escapeHtml((p.b.label || '').trim());
    return `<div class="insight-pair">
      <div class="insight-pair-row">${createNodeChip(p.a)}<span class="insight-bi" aria-hidden="true">${biIc}</span>${createNodeChip(p.b)}</div>
      ${terms ? `<div class="insight-shared">공통 (${escapeHtml(terms)})</div>` : ''}
      <div class="insight-acts">
        <button class="insight-arrow" onclick="insightConnectDir(${i},'ba')" title="${lb} → ${la} (노드 연결)">←</button>
        <button class="insight-arrow" onclick="insightConnectDir(${i},'ab')" title="${la} → ${lb} (노드 연결)">→</button>
        <button class="insight-ic-btn" onclick="insightShowPair(${i})" title="그래프 보기">${zoomIc}</button>
        <button class="insight-ic-btn" onclick="insightDismiss(${i})" title="닫기">${closeIc}</button>
      </div>
    </div>`;
  }).join('');
}

// 방향 연결(단방향) — 노션 본문에 링크 기록(위키링크). dir: 'ab'=왼→오, 'ba'=오→왼
function insightConnectDir(i, dir) {
  const p = _linkSuggestCache && _linkSuggestCache[i];
  if (!p || !nodeMap[p.a.id] || !nodeMap[p.b.id]) return;
  const from = dir === 'ba' ? p.b : p.a, to = dir === 'ba' ? p.a : p.b;
  if (from.id === to.id) return;
  if (typeof _hasWikiLinkTo === 'function' && _hasWikiLinkTo(from, to)) {
    toast('이미 연결됨');
  } else {
    _wikiConnect(from, to); // from 본문에 [to](url) 추가 → from → to 단방향, 노션에 반영
    toast(`연결 · ${(from.label || '').trim()} → ${(to.label || '').trim()}`, { type: 'success' });
  }
  if (typeof highlightAiNodes === 'function') highlightAiNodes([from, to]);
  _refreshSuggest(); // 이은 쌍은 다음 후보로 교체
}

// 그래프에서 보기 → 두 노드 하이라이트
function insightShowPair(i) {
  const p = _linkSuggestCache && _linkSuggestCache[i];
  if (!p) return;
  if (typeof highlightAiNodes === 'function') highlightAiNodes([p.a, p.b]);
}

// 닫기 → 다시 제안 안 함 + 다음 후보로 즉시 교체
function insightDismiss(i) {
  const p = _linkSuggestCache && _linkSuggestCache[i];
  if (!p) return;
  _dismissedPairs.add(_pairKey(p.a, p.b)); _saveDismissed();
  _refreshSuggest();
}

function _refreshSuggest() {
  _linkSuggestCache = _computeLinkSuggestions(5);
  const body = document.getElementById('insight-suggest-body');
  if (body) body.innerHTML = _renderSuggestHtml(_linkSuggestCache);
}

// 현재 불러온 그래프를 버림 — 시작 화면에서 새로 고를 때 이전 페이지가 섞이지 않게
function discardCurrentGraph() {
  nodes = []; edges = [];
  Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
  if (typeof _addedPageIds !== 'undefined') _addedPageIds.clear();
  if (typeof _stack !== 'undefined') _stack = [];
  if (typeof _activeNode !== 'undefined') _activeNode = null;
  if (typeof closePanel === 'function') closePanel();
  if (typeof clearMultiSelect === 'function') clearMultiSelect();
  if (typeof clearGraphHighlight === 'function') clearGraphHighlight();
  if (typeof _recentNodes !== 'undefined') _recentNodes = [];
  if (typeof _linkSuggestCache !== 'undefined') _linkSuggestCache = null;
  window._sidebarPageList = [];
  window._NOTION_MARKDOWN = ''; window._NOTION_TITLE = '';
  // 저장된 페이지 목록도 지워야 새로고침 때 버린 그래프가 되살아나지 않음
  if (typeof snRemove === 'function') snRemove('snlog_pages', 'pages');
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'none';
  if (typeof refreshSidebarRender === 'function') refreshSidebarRender();
  if (typeof renderMdFolderList === 'function') renderMdFolderList();
  if (typeof updateBulkActionsVisibility === 'function') updateBulkActionsVisibility();
  if (typeof renderBookmarkList === 'function') renderBookmarkList();
  isStable = false;
}

// 좌측 레일 로고 → 처음 시작(노션 연결·MD) 화면 다시 열기 (확인 후)
function backToLoginScreen() {
  showConfirm('시작 화면으로', '현재 그래프를 비우고\n시작 화면으로 돌아갑니다.', () => {
    closeRailFlyout();
    discardCurrentGraph();
    const ls = document.getElementById('login-screen');
    if (ls) ls.style.display = '';
    // 페이지 선택 화면이 토큰 폼을 덮어쓴 상태일 수 있으므로 원본 마크업으로 되돌림
    const box = document.getElementById('login-box');
    if (box && window._loginBoxHtml) box.innerHTML = window._loginBoxHtml;
    const tokenIn = document.getElementById('input-token');
    if (tokenIn && _savedToken) tokenIn.value = _savedToken;
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
  }, true);
}

