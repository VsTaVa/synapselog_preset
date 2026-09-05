// ── 사이드바 토글 ─────────────────────────────────────────────────────

// 패널 열고/닫을 때 트랜지션(0.28s) 후 화면 맞춤
function _autoFitPanel() { setTimeout(() => { try { fitGraph(false); } catch (e) {} }, 320); }

// ── 좌측 액티비티 레일: 섹션 플라이아웃 ──────────────────────────────
let _activeRailSection = null;
const _railSections = ['pages', 'search', 'graphcfg', 'aichat'];
function openRailSection(name) {
  if (_activeRailSection === name) { closeRailFlyout(); return; }
  _activeRailSection = name;
  // 범례 패널은 _legendOpen이 따로 관리한다 — 여기서 같이 끄면 섹션을 바꿀 때 도움말이 사라진다
  document.querySelectorAll('#sidebar .rail-pane').forEach(el => {
    if (el.dataset.section === 'legend') return;
    el.classList.toggle('active', el.dataset.section === name);
  });
  _railSections.forEach(k => { const b = document.getElementById('rail-' + k); if (b) b.classList.toggle('active', k === name); });
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.add('open');
  // 좌우로 못 나누는 상황이면 상세 패널을 접는다 (반대 방향은 ui-panel의 _yieldSidebarIfNarrow)
  if (_panelsExclusive() && typeof collapseDetailPanel === 'function') collapseDetailPanel();
  if (name === 'search') {
    setTimeout(() => document.getElementById('search-input')?.focus(), 60);
    if (typeof renderSearchHistory === 'function') renderSearchHistory();
    if (typeof renderPopularKeywords === 'function') renderPopularKeywords();
    if (typeof renderFrequentKeywords === 'function') renderFrequentKeywords();
  }
  if (name === 'aichat') { setTimeout(() => document.getElementById('aichat-input')?.focus(), 60); if (typeof _renderAiChat === 'function') _renderAiChat(); }
  if (name === 'pages') { renderBookmarkList(); renderInsights(); } // 노드 섹션이 페이지 목록에 합쳐짐
  // 수정 시각을 보여주는데 목록을 다시 안 받으면 저장된 옛 값이 그대로 뜬다.
  // 열 때마다 쏘지는 않게 1분은 그냥 쓴다(조용히 갱신 — 목록이 깜빡이지 않는다).
  if (name === 'pages' && typeof refreshSidebarPageList === 'function'
      && typeof _pageListAt !== 'undefined' && Date.now() - _pageListAt > 60000) {
    refreshSidebarPageList(true).catch(() => {});
  }
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
// ── 레일 패널 항목 설명 (? 토글) ────────────────────────────────────
// 문구는 각 항목의 data-help 한 곳에만 — 여기 또 적으면 반드시 어긋난다
// 켜짐 여부는 패널별로 따로 기억한다(패널 id가 키)
let _helpOpen = (() => { try { return JSON.parse(localStorage.getItem('snlog_help') || '{}'); } catch (e) { return {}; } })();
// 도안이 큰 레일 아이콘은 icons.js에서 채운다 — HTML에 수 KB짜리 path를 박지 않게
(() => { const b = document.getElementById('rail-graphcfg'); if (b && !b.innerHTML && typeof sliderIcon === 'function') b.innerHTML = sliderIcon(20); })();
function toggleRailHelp(panelId) {
  if (!_helpOpen[panelId]) markNewSeen(document.getElementById(panelId)); // 켜는 순간에만
  _helpOpen[panelId] = !_helpOpen[panelId];
  try { localStorage.setItem('snlog_help', JSON.stringify(_helpOpen)); } catch (e) {}
  applyRailHelp();
}
// ── 새 기능 표시 ────────────────────────────────────────────────────
// 대상 요소에 data-new="키"만 달면 된다 — 목록을 따로 두면 DOM과 어긋난다.
// 그 패널의 도움말을 한 번 열면 본 것으로 치고 표시가 사라진다
let _seenNew = (() => { try { return new Set(JSON.parse(localStorage.getItem('snlog_seen_new') || '[]')); } catch (e) { return new Set(); } })();
function applyNewBadges() {
  document.querySelectorAll('.ui-help-btn.has-new').forEach(b => b.classList.remove('has-new'));
  document.querySelectorAll('[data-new]').forEach(el => {
    if (_seenNew.has(el.dataset.new)) return;
    if (el.style.display === 'none') return; // 아직 안 보이는 영역은 알릴 것도 없다
    const pane = el.closest('.rail-pane');
    const btn = pane && pane.querySelector('.ui-help-btn');
    if (btn) btn.classList.add('has-new');
  });
}
// 도움말을 연 패널의 새 표시는 본 것으로 — 설명을 읽을 기회를 이미 준 셈이다
function markNewSeen(panel) {
  if (!panel) return;
  let changed = false;
  panel.querySelectorAll('[data-new]').forEach(el => { if (!_seenNew.has(el.dataset.new)) { _seenNew.add(el.dataset.new); changed = true; } });
  if (!changed) return;
  try { localStorage.setItem('snlog_seen_new', JSON.stringify([..._seenNew])); } catch (e) {}
}
function applyRailHelp() {
  document.querySelectorAll('#sidebar .rail-pane').forEach(panel => {
    const on = !!_helpOpen[panel.id];
    const btn = panel.querySelector('.ui-help-btn');
    if (btn) {
      if (!btn.innerHTML && typeof infoIcon === 'function') btn.innerHTML = infoIcon(13); // 도안은 icons.js 한 곳에서
      btn.classList.toggle('on', on);
    }
    panel.querySelectorAll('.ms-desc').forEach(d => d.remove());
    if (!on) return;
    panel.querySelectorAll('[data-help]').forEach(el => {
      if (el.style.display === 'none') return; // 비어서 감춘 목록에 설명만 남지 않게
      // 슬라이더는 제목 바로 밑(설명 다음이 슬라이더), 가로로 놓인 설정 줄은 줄 끝, 나머지는 형제로
      let after = el.querySelector('.ctrl-label-row') || (el.classList.contains('ctrl-group') ? null : el);
      el.dataset.help.split('|').forEach(t => {
        const d = document.createElement('small');
        d.className = 'ms-desc';
        d.textContent = t;
        // 커서를 방금 넣은 줄로 옮긴다 — 매번 같은 자리에 끼우면 여러 줄이 거꾸로 쌓인다
        if (after) { after.insertAdjacentElement('afterend', d); after = d; } else el.appendChild(d);
      });
    });
  });
  applyNewBadges();
}
applyRailHelp();

const _RAIL_CARET = `<svg class="rail-sec-caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
// 접히는 소제목 머리글 (JS로 그리는 레일 섹션용)
function railSecHead(key, label, extraCls, help) {
  const cls = 'rail-subhead rail-sec-head' + (extraCls ? ' ' + extraCls : '') + (isRailSecOpen(key) ? '' : ' closed');
  const h = help ? ` data-help="${escapeHtml(help)}"` : '';
  return `<button type="button" class="${cls}" data-sec="${key}"${h} onclick="toggleRailSec('${key}')">${_RAIL_CARET}${label}</button>`;
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
  const xIc = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  // 북마크·자주·최근 모두 중심 노드와 같은 칩 — 노드 색으로 구분, 부가정보는 오른쪽에
  const chipItem = (n, tail, rank) =>
    `<span class="insight-chipwrap bm-chip" data-nid="${n.id}">${rank ? `<span class="chip-rank">${rank}.</span>` : ''}${createNodeChip(n)}${tail || ''}</span>`;
  const chipList = (arr, fn) => `<div class="insight-chips">${arr.map(fn).join('')}</div>`;
  const bms = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && isBookmarked(n));
  const recents = (typeof _recentNodes !== 'undefined' ? _recentNodes : []).map(id => nodeMap[id]).filter(n => n && n.visible);
  let html = railSecHead('bm', '북마크', '', '노드 우클릭 → 북마크로 담은 노드');
  html += railSecBody('bm', bms.length ? chipList(bms, n => chipItem(n))
    : `<div class="rail-empty">북마크 노드 모음</div>`);
  html += railSecHead('recent', '최근 본 노드', 'mt', '클릭해서 연 노드 기록. 최대 10개');
  html += railSecBody('recent', recents.length
    ? chipList(recents, (n, i) => chipItem(n, `<button class="bm-x" onclick="event.stopPropagation();removeRecentNode('${n.id}')" title="목록에서 제거" aria-label="목록에서 제거">${xIc}</button>`, i + 1))
    : `<div class="rail-empty">클릭한 노드 기록</div>`);
  el.innerHTML = html;
  // 칩은 전역 핸들러가 패널을 열어주므로 여기선 카메라 이동만
  applyRailHelp(); // innerHTML을 갈아끼웠으니 설명도 다시 붙인다
  el.querySelectorAll('.bm-chip').forEach(w => {
    w.onclick = () => {
      const n = nodeMap[w.dataset.nid];
      if (n && typeof focusViewOnNode === 'function') focusViewOnNode(n);
    };
  });
}

// 최근 본 노드 목록에서 항목 하나 제거 (메모리에만 있는 기록이라 목록만 갱신)
function removeRecentNode(id) {
  _recentNodes = _recentNodes.filter(x => x !== id);
  renderBookmarkList();
}

function closeRailFlyout() {
  if (!_activeRailSection) return;
  _activeRailSection = null;
  // 섹션 패널은 내려준다(범례는 제외) — 안 그러면 닫았는데도 계속 보인다
  document.querySelectorAll('#sidebar .rail-pane').forEach(el => {
    if (el.dataset.section !== 'legend') el.classList.remove('active');
  });
  // 범례가 켜져 있으면 사이드바는 열어둔다 — 범례가 그 안에 살기 때문
  const keepOpen = typeof _legendOpen !== 'undefined' && _legendOpen;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.toggle('open', keepOpen);
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
  let html = '';
  // 연결 제안 (제목 키워드 겹침 · 토큰 0 · 최대 5)
  _linkSuggestCache = _computeLinkSuggestions(3);
  html += `<div class="insight-sec">` + railSecHead('suggest', '연결 제안', 'mt', '제목 키워드가 겹치는 노드 쌍. AI 없이 계산');
  html += railSecBody('suggest', `<div id="insight-suggest-body">` + _renderSuggestHtml(_linkSuggestCache) + `</div>`) + `</div>`;

  el.innerHTML = html;
  applyRailHelp(); // innerHTML을 갈아끼웠으니 설명도 다시 붙인다
}

function _renderSuggestHtml(list) {
  list = (list || []).filter(p => nodeMap[p.a.id] && nodeMap[p.b.id]);
  if (!list.length) return `<div class="rail-empty">이을 만한 노드 없음</div>`;
  const closeIc = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const upIc = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>`;
  const downIc = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>`;
  return list.map((p, i) => {
    const terms = (p.terms || []).slice(0, 3).join(', ');
    const la = escapeHtml((p.a.label || '').trim()), lb = escapeHtml((p.b.label || '').trim());
    // 화살표는 각 칩 앞에 — 위 칩으로 올려붙이면 ↑, 아래 칩으로 내려붙이면 ↓
    const dirBtn = (dir, ic, from, to) =>
      `<button class="insight-dir" onclick="insightConnectDir(${i},'${dir}')" title="${from} → ${to} (노드 연결)" aria-label="${from} → ${to} 연결">${ic}</button>`;
    // 카드에 마우스를 올리면 그래프에서 두 노드를 보여준다(돋보기 버튼 대체)
    return `<div class="insight-pair" onmouseenter="insightHoverPair(${i})" onmouseleave="insightHoverCancel()">
      <button class="insight-x" onclick="insightDismiss(${i})" title="다시 제안 안 함" aria-label="다시 제안 안 함">${closeIc}</button>
      <div class="insight-pair-row">
        <span class="insight-pair-line">${dirBtn('ba', upIc, lb, la)}${createNodeChip(p.a, { maxLen: 26 })}</span>
        <span class="insight-pair-line">${dirBtn('ab', downIc, la, lb)}${createNodeChip(p.b, { maxLen: 26 })}</span>
      </div>
      ${terms ? `<div class="insight-shared">제안 이유: ${escapeHtml(terms)}</div>` : ''}
    </div>`;
  }).join('');
}

// 방향 연결(단방향) — 본문에 링크 기록(위키링크). 칩이 상하 배치라 dir: 'ab'=위→아래, 'ba'=아래→위
function insightConnectDir(i, dir) {
  const p = _linkSuggestCache && _linkSuggestCache[i];
  if (!p || !nodeMap[p.a.id] || !nodeMap[p.b.id]) return;
  const from = dir === 'ba' ? p.b : p.a, to = dir === 'ba' ? p.a : p.b;
  if (from.id === to.id) return;
  if (typeof isPairConnected === 'function' && isPairConnected(from, to)) {
    toast('이미 연결됨');
  } else {
    toggleWikiConnect(from, to); // 출처가 같으면 본문에 기록, 다르면 수동 연결로
    toast(`연결 & ${(from.label || '').trim()} → ${(to.label || '').trim()}`, { type: 'success' });
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
// 카드 호버 → 그래프에서 보기. 스치듯 지나가는 건 무시하려고 살짝 늦춘다.
// 벗어나도 하이라이트는 유지 — 그래프를 보는 동안 꺼지면 쓸모가 없다
let _insightHoverTimer = null;
function insightHoverPair(i) {
  clearTimeout(_insightHoverTimer);
  _insightHoverTimer = setTimeout(() => insightShowPair(i), 180);
}
function insightHoverCancel() { clearTimeout(_insightHoverTimer); }

// 닫기 → 다시 제안 안 함 + 다음 후보로 즉시 교체
function insightDismiss(i) {
  const p = _linkSuggestCache && _linkSuggestCache[i];
  if (!p) return;
  _dismissedPairs.add(_pairKey(p.a, p.b)); _saveDismissed();
  _refreshSuggest();
}

function _refreshSuggest() {
  _linkSuggestCache = _computeLinkSuggestions(3);
  const body = document.getElementById('insight-suggest-body');
  if (body) body.innerHTML = _renderSuggestHtml(_linkSuggestCache);
}


