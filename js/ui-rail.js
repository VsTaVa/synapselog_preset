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
  if (name === 'search') { setTimeout(() => document.getElementById('search-input')?.focus(), 60); if (typeof renderPopularKeywords === 'function') renderPopularKeywords(); }
  if (name === 'aichat') { setTimeout(() => document.getElementById('aichat-input')?.focus(), 60); if (typeof _renderAiChat === 'function') _renderAiChat(); }
  if (name === 'bookmarks') { renderBookmarkList(); renderInsights(); }
}

// 북마크한 노드 목록 (레일 섹션) — 클릭 시 그 노드로 이동 + 패널 열기
// 노드 섹션: 북마크 + 최근 본 노드
let _recentNodes = [];
function renderBookmarkList() {
  const el = document.getElementById('bookmark-list');
  if (!el) return;
  const bmIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#ed7000" stroke="#ed7000" stroke-width="1.5" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  const clockIc = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`;
  const rowHtml = (n, ic) => `<div class="bm-item" data-nid="${n.id}" title="${escapeHtml((n.label || '(제목 없음)').trim())}"><span class="bm-ic">${ic}</span><span class="bm-label">${escapeHtml((n.label || '(제목 없음)').trim())}</span></div>`;
  const bms = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && isBookmarked(n));
  const recents = (typeof _recentNodes !== 'undefined' ? _recentNodes : []).map(id => nodeMap[id]).filter(n => n && n.visible);
  let html = `<div class="rail-subhead">북마크</div>`;
  html += bms.length ? bms.map(n => rowHtml(n, bmIcon)).join('')
    : `<div class="rail-empty">노드 선택 후 <b>북마크</b>를 누르면 여기에 모여요.</div>`;
  html += `<div class="rail-subhead mt">최근 본 노드</div>`;
  html += recents.length ? recents.map(n => rowHtml(n, clockIc)).join('')
    : `<div class="rail-empty">아직 없어요.</div>`;
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
function closeRailFlyout() {
  if (!_activeRailSection) return;
  _activeRailSection = null;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
  _railSections.forEach(k => { const b = document.getElementById('rail-' + k); if (b) b.classList.remove('active'); });
}
function toggleSidebar() { closeRailFlyout(); } // 구버전 호환(Esc 등)

// ── 통찰(Insight) : "적히지 않은 관계"를 계산해서 제안 (노드 탭에 병합) ──────
// 중심(허브)·연결 제안 모두 순수 그래프/키워드 계산 (AI·토큰 0).
let _linkSuggestCache = null;
let _dismissedPairs = new Set(); // 거절한 쌍 "idA|idB"(정렬) — 다시 제안 안 함
function _pairKey(aId, bId) { return [aId, bId].sort().join('|'); }
function _saveDismissed() {
  if (!_useLocalStorage) return;
  try { localStorage.setItem('snlog_dismissed_pairs', JSON.stringify([..._dismissedPairs])); } catch (e) {}
}
(function _restoreDismissed() {
  try { if (!_useLocalStorage) return; const s = localStorage.getItem('snlog_dismissed_pairs'); if (s) JSON.parse(s).forEach(k => _dismissedPairs.add(k)); } catch (e) {}
})();

function _nodeDegree(id) { let d = 0; edges.forEach(e => { if (e.from === id || e.to === id) d++; }); return d; }
function _crossLinkCount(id) { let c = 0; edges.forEach(e => { if ((e.manualLink || e.wikiLink) && (e.from === id || e.to === id)) c++; }); return c; }

// 중심(허브): 연결 3개 초과(=4개 이상) 노드만, 연결 많은 순 top N
function _computeHubs(topN) {
  const vis = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && !n._aiSummary);
  const scored = vis.map(n => { const deg = _nodeDegree(n.id); const cross = _crossLinkCount(n.id); return { n, deg, cross, score: deg + cross * 2 }; });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(x => x.deg > 3).slice(0, topN);
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
      if (_dismissedPairs.has(_pairKey(A.n.id, B.n.id))) continue; // 거절한 쌍 제외
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
  html += `<div class="insight-sec"><div class="rail-subhead mt">중심 노드</div>`;
  html += hubs.length
    ? `<div class="insight-chips">` + hubs.map(h => `<span class="insight-chipwrap" title="연결 ${h.deg}개${h.cross ? ' · 교차 ' + h.cross : ''}">${createNodeChip(h.n)}<span class="insight-badge">${h.deg}</span></span>`).join('') + `</div>`
    : `<div class="rail-empty">연결 4개 이상 노드 없음</div>`;
  html += `</div>`;

  // 연결 제안 (제목 키워드 겹침 · 토큰 0 · 최대 5)
  _linkSuggestCache = _computeLinkSuggestions(5);
  html += `<div class="insight-sec"><div class="rail-subhead mt">연결 제안</div>`;
  html += `<div id="insight-suggest-body">` + _renderSuggestHtml(_linkSuggestCache) + `</div></div>`;

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
      <div class="insight-acts">
        <button class="insight-arrow" onclick="insightConnectDir(${i},'ba')" title="${lb} → ${la} (노션에 기록)">←</button>
        <button class="insight-arrow" onclick="insightConnectDir(${i},'ab')" title="${la} → ${lb} (노션에 기록)">→</button>
        <button class="insight-ic-btn" onclick="insightShowPair(${i})" title="그래프에서 보기">${zoomIc}</button>
        <button class="insight-ic-btn" onclick="insightDismiss(${i})" title="닫기">${closeIc}</button>
      </div>
      ${terms ? `<div class="insight-shared">공통 (${escapeHtml(terms)})</div>` : ''}
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
  _dismissedPairs.add(_pairKey(p.a.id, p.b.id)); _saveDismissed();
  _refreshSuggest();
}

function _refreshSuggest() {
  _linkSuggestCache = _computeLinkSuggestions(5);
  const body = document.getElementById('insight-suggest-body');
  if (body) body.innerHTML = _renderSuggestHtml(_linkSuggestCache);
}

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

