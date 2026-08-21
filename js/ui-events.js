// ── 검색 ──────────────────────────────────────────────────────────────

const _searchHistory = [];
const MAX_HISTORY = 8;

// 검색 횟수 누적 — '자주 검색하는 키워드'용 (검색 기록과 달리 지워도 남는 통계)
let _searchCounts = (() => { try { return JSON.parse(snGet('snlog_search_counts', 'search') || '{}'); } catch (e) { return {}; } })();
function _saveSearchCounts() { snSet('snlog_search_counts', JSON.stringify(_searchCounts), 'search'); }

function renderSearchHistory() {
  const el = document.getElementById('search-history');
  if (!el) return;
  if (searchKeyword || !_searchHistory.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rail-subhead" data-help="최근 검색한 키워드. 클릭하면 다시 검색">검색 기록</div><div class="sp-chips">`
    + _searchHistory.map((kw, i) => `<span class="sp-chip sp-chip-del"><button class="sp-chip-go" onclick="runKeyword('${escapeHtml(kw).replace(/'/g, "&#39;")}')">${escapeHtml(kw)}</button><button class="sp-chip-x" onclick="deleteHistory(${i},event)" aria-label="기록 삭제">✕</button></span>`).join('')
    + `</div>`;
  el.style.display = 'block';
  applyRailHelp(); // innerHTML을 갈아끼웠으니 설명도 다시 붙인다
}

function addHistory(kw) {
  if (!kw || kw.length < 1) return;
  const idx = _searchHistory.indexOf(kw);
  if (idx !== -1) _searchHistory.splice(idx, 1);
  _searchHistory.unshift(kw);
  if (_searchHistory.length > MAX_HISTORY) _searchHistory.pop();
  saveSearchHistory();
  _searchCounts[kw] = (_searchCounts[kw] || 0) + 1;
  _saveSearchCounts();
  renderSearchHistory();
  renderFrequentKeywords();
}

function deleteHistory(idx, e) {
  if (e) e.stopPropagation();
  _searchHistory.splice(idx, 1);
  saveSearchHistory();
  renderSearchHistory();
}

// 검색창에 넣고 바로 검색 (칩 클릭 공용)
function runKeyword(kw) {
  const inp = document.getElementById('search-input');
  if (inp) inp.value = kw;
  doSearch(kw);
}

// 자주 검색하는 키워드 — 누적 횟수 2회 이상, 많은 순
function renderFrequentKeywords() {
  const el = document.getElementById('search-frequent');
  if (!el) return;
  const top = Object.entries(_searchCounts).filter(e => e[1] >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  if (searchKeyword || !top.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rail-subhead mt" data-help="두 번 이상 검색한 키워드">자주 검색하는 키워드</div><div class="sp-chips">`
    + top.map(([k, c]) => `<button class="sp-chip" onclick="runKeyword('${escapeHtml(k).replace(/'/g, "&#39;")}')">${escapeHtml(k)}<span class="sp-count">${c}</span></button>`).join('')
    + `</div>`;
  el.style.display = 'block';
  applyRailHelp(); // innerHTML을 갈아끼웠으니 설명도 다시 붙인다
}

// 그래프 노드 제목에서 자주 나오는 키워드 top N (문서빈도 기준, AI 없이 코드로)
function _popularKeywords(topN) {
  const freq = new Map();
  (typeof nodes !== 'undefined' ? nodes : []).forEach(n => {
    if (!n.visible || n._aiSummary || !n.label) return;
    let raw;
    try { raw = (n.label.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); }
    catch (e) { raw = (n.label.toLowerCase().match(/[a-z0-9가-힣]+/g) || []); }
    const seen = new Set();
    raw.forEach(w => {
      if (w.length < 2 || _AI_STOPWORDS.has(w)) return;
      if (/^\d+$/.test(w)) return; // 순수 숫자(날짜 조각 등)는 키워드에서 제외
      let s = w;
      if (/[가-힣]/.test(w) && w.length >= 3) s = _aiStem(w);
      if (s.length < 2 || _AI_STOPWORDS.has(s)) return;
      if (seen.has(s)) return; seen.add(s); // 한 노드에서 같은 단어는 1회만
      freq.set(s, (freq.get(s) || 0) + 1);
    });
  });
  return [...freq.entries()].filter(e => e[1] >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN).map(e => e[0]);
}
function renderPopularKeywords() {
  const el = document.getElementById('search-popular');
  if (!el) return;
  if (searchKeyword) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const kws = _popularKeywords(12);
  if (!kws.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rail-subhead" data-help="노드 제목에 자주 나오는 낱말. 지금 그래프에서 뽑음">주요 키워드</div><div class="sp-chips">` + kws.map(k => `<button class="sp-chip">${escapeHtml(k)}</button>`).join('') + `</div>`;
  el.style.display = 'block';
  applyRailHelp(); // innerHTML을 갈아끼웠으니 설명도 다시 붙인다
  el.querySelectorAll('.sp-chip').forEach(c => { c.onclick = () => { const inp = document.getElementById('search-input'); if (inp) inp.value = c.textContent; doSearch(c.textContent); }; });
}

// ── 그래프 하이라이트 공용 (검색·AI·배경클릭이 공유) ──────────────────
// 활성: 직접 노드 + 조상까지 searchMatches에 담고(마커/키워드 설정) 화면 맞춤
function applyGraphHighlight(directIds, keyword, opts) {
  opts = opts || {};
  searchKeyword = keyword;
  searchMatches.clear(); searchDirect.clear();
  (directIds || []).forEach(id => {
    if (!id) return;
    searchDirect.add(id); searchMatches.add(id);
    getAncestorIds(id, opts.max || 12, false).forEach(a => searchMatches.add(a)); // 수동링크 통과(검색과 동일)
  });
  // opts.also: 활성 범위엔 넣되 흰색 글로우는 안 붙일 노드(예: 허브의 하위 트리)
  (opts.also || []).forEach(id => { if (id) searchMatches.add(id); });
  const cb = (typeof clearBtn !== 'undefined' && clearBtn) ? clearBtn : document.getElementById('clear-btn');
  if (cb) cb.style.display = 'block';
  isStable = false;
  if (opts.fit) { clearTimeout(_searchFitTimer); _searchFitTimer = setTimeout(() => { try { fitGraph(); } catch (e) {} }, opts.fitDelay || 400); }
}
// 비활성: 하이라이트 해제
function clearGraphHighlight() {
  searchKeyword = ''; searchMatches.clear(); searchDirect.clear();
  const cb = (typeof clearBtn !== 'undefined' && clearBtn) ? clearBtn : document.getElementById('clear-btn');
  if (cb) cb.style.display = 'none';
  isStable = false;
}

function doSearch(kw) {
  const resultEl = document.getElementById('search-result-count');
  const resultsEl = document.getElementById('search-results');
  const keyword = kw.trim().toLowerCase();
  const kwns = keyword.replace(/\s+/g, ''); // 띄어쓰기 무시 매칭용 (공백 제거)
  if (keyword) {
    const directMatches = new Set();
    nodes.forEach(n => {
      if (!n.visible) return;
      const lt = n.label.toLowerCase(), dt = n.desc.toLowerCase();
      // 1차: 그대로 매칭 → 실패 시 2차: 양쪽 공백 제거 후 매칭("시장 경제 흐름" ↔ "시장경제흐름")
      if (lt.includes(keyword) || dt.includes(keyword) ||
          (kwns.length && (lt.replace(/\s+/g, '').includes(kwns) || dt.replace(/\s+/g, '').includes(kwns)))) directMatches.add(n.id);
    });
    applyGraphHighlight([...directMatches], keyword, { max: 10, fit: directMatches.size > 0, fitDelay: 450 });
    if (resultsEl) {
      const chips = [...directMatches].map(id => nodeMap[id]).filter(Boolean).slice(0, 60);
      resultsEl.innerHTML = chips.map(n => createNodeChip(n)).join('');
      resultsEl.style.display = chips.length ? 'flex' : 'none';
      // 검색칩 클릭 → 그 노드로 카메라 이동 (패널 열기는 전역 칩 핸들러가 처리)
      resultsEl.querySelectorAll('.node-chip[data-nid]').forEach(el => {
        el.addEventListener('click', () => { const nn = nodeMap[el.dataset.nid]; if (nn && typeof focusViewOnNode === 'function') focusViewOnNode(nn); });
      });
    }
    _searchHits = [...directMatches]; _searchCursor = -1; _searchFocusId = null; // 엔터를 다시 누르면 여기부터 하나씩 돈다
    _updateSearchCount();
  } else {
    clearGraphHighlight();
    _searchHits = []; _searchCursor = -1; _searchFocusId = null; _searchNavMode = false;
    if (resultEl) resultEl.style.display = 'none';
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
  }
  if (typeof renderPopularKeywords === 'function') renderPopularKeywords();
  if (typeof renderSearchHistory === 'function') renderSearchHistory();
  if (typeof renderFrequentKeywords === 'function') renderFrequentKeywords();
  isStable = false;
}
let _searchFitTimer = null;

// 검색 결과 순회 — 엔터를 다시 누르면 다음 결과로 카메라가 간다(Shift+엔터는 역방향)
let _searchHits = [], _searchCursor = -1, _searchCommitted = '';
function _updateSearchCount() {
  const el = document.getElementById('search-result-count');
  if (!el) return;
  if (!_searchHits.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = _searchCursor >= 0 ? `${_searchCursor + 1} / ${_searchHits.length}` : `${_searchHits.length}개 결과`;
}
function gotoSearchMatch(dir) {
  if (!_searchHits.length) return;
  _searchCursor = (_searchCursor + dir + _searchHits.length) % _searchHits.length;
  const id = _searchHits[_searchCursor], n = nodeMap[id];
  _searchFocusId = id;
  if (n && typeof focusViewOnNode === 'function') focusViewOnNode(n);
  _searchNavMode = true; // 이 동안은 검색란과 패널을 같이 연다(안 그러면 패널이 검색란을 밀어낸다)
  if (n && typeof openPanel === 'function') openPanel(n, { only: true });
  if (typeof _activeRailSection !== 'undefined' && _activeRailSection !== 'search'
      && typeof openRailSection === 'function') openRailSection('search'); // 이미 밀려 닫혔으면 되편다
  _markSearchChip(id);
  _updateSearchCount();
  isStable = false; // 펄스가 돌려면 물리가 멎어도 다시 그려야 한다
}
// 결과 칩 목록에서도 지금 보고 있는 것만 깜빡이게
function _markSearchChip(id) {
  const box = document.getElementById('search-results');
  if (!box) return;
  let hit = null;
  box.querySelectorAll('.node-chip[data-nid]').forEach(el => {
    const on = el.dataset.nid === String(id);
    el.classList.toggle('chip-pulse', on);
    if (on) hit = el;
  });
  // 목록이 길면 깜빡이는 칩이 스크롤 밖에 있다 — 보이는 자리로 끌어온다
  if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'nearest' });
}

// AI 근거/추천 노드들을 그래프에서 하이라이트 (검색 하이라이트 메커니즘 재활용)
function highlightAiNodes(nodeList) {
  const arr = (nodeList || []).filter(Boolean);
  if (!arr.length || typeof searchMatches === 'undefined') return;
  applyGraphHighlight(arr.map(n => n && n.id).filter(Boolean), '\uE000', { max: 12, fit: true, fitDelay: 320 }); // 마커=본문에 없는 문자(비면 하이라이트 꺼짐)
}

searchInput.addEventListener('input', e => doSearch(e.target.value));
// 확정 검색(엔터·검색 버튼)만 기록 — 타이핑 중간값이 기록에 쌓이지 않게
function _commitSearch() { const kw = searchInput.value.trim(); doSearch(kw); if (kw) addHistory(kw); }
// 엔터와 돋보기가 같게 동작한다 — 처음이면 검색, 같은 말로 또 누르면 다음 결과로
function searchCommitOrNext(back) {
  const kw = searchInput.value.trim();
  if (kw && kw === _searchCommitted && _searchHits.length) { gotoSearchMatch(back ? -1 : 1); return; }
  _commitSearch(); _searchCommitted = kw;
}
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchCommitOrNext(e.shiftKey); });
// 검색 섹션이 열려 있으면 어디를 보고 있든 엔터로 다음 결과 — 검색란에 커서를 돌려놓게 하는 건 번거롭다.
// 글을 쓰는 중(입력창·본문 편집)에는 엔터가 그쪽 것이므로 건드리지 않는다
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (typeof _activeRailSection === 'undefined' || _activeRailSection !== 'search') return;
  if (!_searchHits.length) return;
  const t = e.target;
  if (t && (t === searchInput || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  gotoSearchMatch(e.shiftKey ? -1 : 1);
});
document.getElementById('search-btn').addEventListener('click', () => searchCommitOrNext(false));
clearBtn.addEventListener('click', () => { searchInput.value = ''; doSearch(''); });


// ── 캔버스 이벤트 ─────────────────────────────────────────────────────

let mouseDownNode = null, mouseDownTime = 0;

// ── 노드 삭제 (노드 선택 모드 메뉴에서 사용) ──────────────────────────
function _subtreeIds(rootId) {
  const ids = [rootId], q = [rootId];
  while (q.length) { const id = q.shift(); edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !ids.includes(e.to)) { ids.push(e.to); q.push(e.to); } }); }
  return ids;
}
function canDeleteNode(n) { return !!(n && (n.local || n.notionBlockId)) && !isReadOnlyNode(n); }

// 노드 하나의 노션 블록 삭제 → 지운 블록 ID 배열(실행 취소용)
// 헤딩 노드는 서버가 실제 children을 훑어 섹션 통째로 지운다 — 예전처럼 아는 본문 블록만 지우면
// 코드·이미지·구분선·표처럼 앱이 못 읽는 블록이 앞 헤딩 밑에 고아로 남았다
async function _deleteNodeBlocks(nd) {
  const known = [];
  if (nd.notionBlockId) known.push(nd.notionBlockId);
  (nd.bodyBlocks || []).forEach(b => { if (b.id) known.push(b.id); });
  if (nd.notionBlockId) {
    try {
      const ids = await notionDeleteSection(nd.notionBlockId, nd.notionParentId);
      if (ids.length) return ids;
    } catch (e) { /* 아래 예전 방식으로 폴백 */ }
  }
  for (const bid of known) { try { await notionDeleteBlock(bid); } catch (e) {} }
  return known;
}
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
    // 서브트리의 모든 노션 블록(헤딩 + 그 섹션)을 삭제 — 본문은 헤딩의 형제라 따로 지워야 함
    const blockIds = [];
    for (const id of idArr) {
      const nd = nodeMap[id]; if (!nd) continue;
      blockIds.push(...await _deleteNodeBlocks(nd));
    }
    undoEntry.blockIds = blockIds;
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
  const parentEdge = getParentEdge(id);
  const parentId = parentEdge ? parentEdge.from : null;
  const origTouching = edges.filter(e => e.from === id || e.to === id); // 복원용 원본 엣지 참조
  const childStructEdges = origTouching.filter(e => e.from === id && !e.weakLink && !e.manualLink);
  const addedEdges = parentId ? childStructEdges.map(ce => ({ from: parentId, to: ce.to })) : [];

  const undoEntry = {
    rootId: id, local: !!node.local, level: node.level, sourcePageId: node.sourcePageId, label: node.label,
    nodes: [node], edges: origTouching, addedEdges, blockIds: []
  };
  if (!node.local) {
    // 이 노드의 섹션만 삭제 — 다음 헤딩(=하위 노드) 앞에서 멈추므로 하위는 노션에 그대로 남는다
    undoEntry.blockIds = await _deleteNodeBlocks(node);
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
  const parentEdge = getParentEdge(node.id);
  const keep = !!parentEdge && nodeHasChildren(node);
  deleteNodeConfirm(node, keep);
}

// 노드 삭제 진입점 — keepChildren=true면 이 노드만 삭제(하위 보존)
function deleteNodeConfirm(node, keepChildren) {
  if (!node || !canDeleteNode(node)) { toast('해당 노드는 삭제 불가 (페이지&DB 노드는 목록 ✕로)', { type: 'error' }); return; }
  if (keepChildren) {
    const parentEdge = getParentEdge(node.id);
    if (!parentEdge) { toast('상위 노드가 없어 해당 노드만 삭제 불가', { type: 'error' }); return; }
    const childCount = edges.filter(e => e.from === node.id && !e.weakLink && !e.manualLink).length;
    const msg = `'${node.label}' 노드만 삭제.\n하위 ${childCount}개는 상위 노드로 이동.` + (!node.local ? '\n(노션에서 삭제 — 실행 취소 가능)' : '');
    showConfirm('해당 노드만 삭제', msg, async () => {
      _undoDelete = { entries: [] };
      await deleteNodeOnly(node);
      if (_undoDelete.entries.length) toast('노드 삭제됨 (하위 보존)', { type: 'success', duration: 6000, action: { label: '실행 취소', onClick: undoLastDelete } });
      else _undoDelete = null;
    }, true);
  } else {
    const total = _subtreeIds(node.id).length;
    const msg = `'${node.label}' 노드(하위 포함 총 ${total}개) 삭제.` + (!node.local ? '\n(노션에서 삭제 — 실행 취소 가능)' : '');
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
  if (isPanning) { panX = panStartOffsetX + (e.clientX - panStartX); panY = panStartOffsetY + (e.clientY - panStartY); resetFitCycle(); return; }
  const n = getNodeAt(e.clientX, e.clientY);
  hoveredNode = n;
  canvas.style.cursor = n ? 'pointer' : 'default';
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
  // 화면 밖 페이지 표시를 눌렀으면 그 페이지로 간다(그래프 조작보다 먼저 판정)
  const pin = typeof offscreenPinAt === 'function' ? offscreenPinAt(e.clientX, e.clientY) : null;
  if (pin) { focusViewOnNode(pin); e.preventDefault(); return; }
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
  if (elapsed < 150 && n && n === mouseDownNode && _connectMode && canConnectNode(n)) {
    handleConnectClick(n);
  } else if (elapsed < 150 && n && n === mouseDownNode && (e.ctrlKey || e.metaKey)) {
    // Ctrl/⌘+클릭 → 노드 고정/해제
    clearTimeout(_clickTimer);
    n.fixed = !n.fixed;
    if (!n.fixed) { n.vx = 0; n.vy = 0; }
    unfreezeSubtree(n); saveFixedPositions(); isStable = false;
  } else if (elapsed < 150 && n && n === mouseDownNode) {
    clearTimeout(_clickTimer); _clickTimer = setTimeout(() => toggleNodePanel(n), 220);
  } else if (elapsed < 150 && !n) {
    clearAllModes();
  }
  if (drag && drag.fixed) saveFixedPositions();
  drag = null; isPanning = false;
});

// 모드별 해제 — 상태 칩에서 하나만 끌 수 있어야 해서 쪼갰다(clearAllModes가 이걸 다시 부른다)
function clearSearchMode() {
  if (typeof searchKeyword === 'undefined' || !searchKeyword) return;
  if (typeof searchInput !== 'undefined' && searchInput) searchInput.value = '';
  doSearch(''); // 검색/AI 하이라이트 해제
}
function clearFocusMode() {
  if (!_focusMode) return;
  _focusMode = false; _focusNodeId = null; _activeGlowIds = new Set();
  nodes.forEach(nd => { nd.dimmed = false; }); isStable = false;
}
function clearIsolateMode() {
  if (!_isolateActive) return;
  _isolateActive = false; _activeGlowIds = new Set();
  nodes.forEach(nd => { nd.dimmed = false; }); isStable = false;
}
function clearConnectMode() {
  if (!_connectMode) return;
  _connectMode = false;
  if (_connectFirstNode) { _connectFirstNode.connectSelected = false; _connectFirstNode = null; }
  nodes.forEach(nd => { nd.connectSelected = false; });
  setStatusHint(''); // 진행 안내도 같이 내린다
  isStable = false;
}
function clearAllModes() {
  clearSearchMode();
  if (_multiSelected.length) clearMultiSelect();
  clearFocusMode();
  clearIsolateMode();
  if (_connectMode) {
    clearConnectMode();
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
  if (closest) { if (confirm(`"${nodeMap[closest.from]?.label}" ↔ "${nodeMap[closest.to]?.label}" 연결 삭제.`)) { removeManualLink(closest.from, closest.to); } }
});

canvas.addEventListener('wheel', e => {
  resetFitCycle(); // 직접 확대·축소했으면 다음 맞춤은 이 페이지부터
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
  if (e.touches.length === 1 && typeof offscreenPinAt === 'function') {
    const t = e.touches[0], pin = offscreenPinAt(t.clientX, t.clientY);
    if (pin) { focusViewOnNode(pin); e.preventDefault(); return; }
  }
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
      panX = panStartOffsetX + (t.clientX - panStartX); panY = panStartOffsetY + (t.clientY - panStartY); resetFitCycle();
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (_touchMode === 'single' && !_touchMoved) {
    const elapsed = Date.now() - mouseDownTime;
    const n = mouseDownNode;
    if (elapsed < 300 && n && _connectMode && canConnectNode(n)) {
      handleConnectClick(n);
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

let _wasSheetLayout = _isSheetLayout();
window.addEventListener('resize', () => {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  // 창을 좁히다 임계폭을 넘어가면 둘 다 열려 있는 상태가 될 수 있다 → 여기서도 한쪽만 남긴다
  if (_panelsExclusive()) {
    const sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open') && typeof collapseDetailPanel === 'function') collapseDetailPanel();
  }
  // 세로↔가로가 뒤집히면 패널이 우측↔하단으로 옮겨가 그래프 영역이 통째로 달라진다 → 다시 맞춤.
  // 창을 조금씩 끄는 동안에는 안 건드린다(계속 다시 맞추면 손과 싸운다). 전환(0.28s) 후 실행.
  const nowSheet = _isSheetLayout();
  if (nowSheet !== _wasSheetLayout) {
    _wasSheetLayout = nowSheet;
    setTimeout(() => { try { fitGraph(false); } catch (e) {} }, 320);
  }
});

// ── 패널 너비 조절 (드래그) ───────────────────────────────────────────

const DETAIL_W_MIN = 280, DETAIL_W_MAX = 720, DETAIL_W_KEEP = 360; // 폭 한계 + 그래프에 남겨둘 최소 가로
const SHEET_H_MIN = 180; // 하단 시트 최소 높이
// 시트 위에 남겨둘 세로 — 레일 아이콘이 다 들어갈 높이라 CSS의 --rail-min-h가 기준.
// 여기서 다시 적으면 둘이 어긋나므로 CSS에서 읽어온다(세로 화면일 때만 정의됨).
function sheetTopKeep() {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-min-h'));
  return v || 160;
}

// 마지막으로 쓰던 크기 기억 — 접거나 닫아도 다시 열 때 그대로. 시트(높이)와 우측 패널(폭)은 따로 저장
function saveDetailWidth() {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--detail-w'));
  if (v) localStorage.setItem('snlog_detail_w', v);
}
function saveSheetHeight() {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'));
  if (v) localStorage.setItem('snlog_sheet_h', v);
}
function saveDetailSize() { if (_isSheetLayout()) saveSheetHeight(); else saveDetailWidth(); }

(function restorePanelWidths() {
  const dw = parseInt(localStorage.getItem('snlog_detail_w') || '');
  if (!dw) return;
  // 넓은 화면에서 저장한 폭이 지금 화면을 다 덮지 않게 — 그래프 자리를 최소한 남기고 복원
  const max = Math.max(DETAIL_W_MIN, Math.min(DETAIL_W_MAX, window.innerWidth - DETAIL_W_KEEP));
  document.documentElement.style.setProperty('--detail-w', Math.min(dw, max) + 'px');
})();

(function restoreSheetHeight() {
  const sh = parseInt(localStorage.getItem('snlog_sheet_h') || '');
  if (sh) document.documentElement.style.setProperty('--sheet-h', sh + 'px');
  // 화면이 짧아 저장값이 과하면 CSS의 min(..., 100dvh - 160px)이 알아서 잘라준다
})();

(function setupPanelResize() {
  const dH = document.getElementById('detail-resize-handle');
  if (!dH) return;
  const COLLAPSE_AT = 200; // 이보다 좁게 끌면 손 떼는 순간 접힘(최소폭 280 아래 저항 구간)
  let active = false, moved = false, willCollapse = false, sx = 0, sy = 0;
  function onMove(clientX, clientY) {
    if (!active) return;
    if (!moved && (Math.abs(clientX - sx) > 5 || Math.abs(clientY - sy) > 5)) moved = true;
    if (!moved) return;
    // 하단 시트일 땐 좌우 폭이 아니라 높이를 조절한다(세로 화면에선 폭 조절이 의미 없음)
    const sheet = _isSheetLayout();
    const raw = sheet ? (window.innerHeight - clientY) : (window.innerWidth - clientX);
    const panel = document.getElementById('detail-panel');
    if (raw < COLLAPSE_AT) { willCollapse = true; dH.classList.add('will-collapse'); if (panel) panel.classList.add('pre-collapse'); }
    else {
      willCollapse = false; dH.classList.remove('will-collapse'); if (panel) panel.classList.remove('pre-collapse');
      if (sheet) {
        const h = Math.max(SHEET_H_MIN, Math.min(window.innerHeight - sheetTopKeep(), raw));
        document.documentElement.style.setProperty('--sheet-h', h + 'px');
      } else {
        const w = Math.max(DETAIL_W_MIN, Math.min(DETAIL_W_MAX, raw));
        document.documentElement.style.setProperty('--detail-w', w + 'px');
      }
    }
  }
  function start(e) {
    active = true; moved = false; willCollapse = false;
    const t = e.touches ? e.touches[0] : e; sx = t.clientX; sy = t.clientY;
    e.preventDefault(); document.body.classList.add('resizing-panel'); dH.classList.add('dragging');
  }
  function end() {
    if (!active) return;
    active = false;
    document.body.classList.remove('resizing-panel'); dH.classList.remove('dragging', 'will-collapse');
    const _p = document.getElementById('detail-panel'); if (_p) _p.classList.remove('pre-collapse');
    const panel = document.getElementById('detail-panel');
    if (!moved) { // 탭 → 패널 접기
      if (typeof toggleDetailPanel === 'function' && panel && !panel.classList.contains('panel-collapsed')) { saveDetailSize(); toggleDetailPanel(); }
      return;
    }
    if (willCollapse) { // 너무 좁게 끌면 아예 접힘
      willCollapse = false;
      saveDetailSize(); // 접히기 직전 크기도 저장 — 다시 열 때 그대로
      if (typeof toggleDetailPanel === 'function' && panel && !panel.classList.contains('panel-collapsed')) toggleDetailPanel();
      return;
    }
    saveDetailSize();
    try { fitGraph(); } catch (e) {} // 크기 바뀐 만큼 화면 맞춤
  }
  dH.addEventListener('mousedown', start);
  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);
  dH.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('touchmove', e => { if (active) { onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  window.addEventListener('touchend', end);
})();

function toggleSection(id) {
  const body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
  localStorage.setItem('snlog_sec_' + id, isOpen ? '0' : '1');
}

// ── 단축키 시스템 ─────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = { toggleLabels: 't', toggleConnections: 'g' };
const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS); // 힌트·설정 버튼이 같은 목록을 읽는다
let _shortcuts = (() => { try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('snlog_shortcuts') || '{}') }; } catch(e) { return { ...DEFAULT_SHORTCUTS }; } })();
// 구버전 단축키 정리 (편집/탐색 모드 통합 → 노드 선택 모드 하나, N 키)
delete _shortcuts.toggleFocusMode; delete _shortcuts.toggleConnectMode; delete _shortcuts.toggleEditMode; delete _shortcuts.toggleMultiSelectMode;
// 조작 목록 — 설정 모달과 도움말이 이 배열 하나를 읽어 그린다(두 곳에 적으면 반드시 어긋난다).
// action이 있으면 사용자가 바꿀 수 있는 키, key가 있으면 고정 조작.
const SHORTCUT_ROWS = [
  { label: '제목 숨김', sub: '제목 크기 0 / 원래 크기', action: 'toggleLabels' },
  { label: '노드 연결 표시', sub: '노드 연결선 표시 / 숨김', action: 'toggleConnections' },
  { label: '패널·범례 닫기', sub: 'Esc (고정)', key: 'Esc' },
  { label: '노드 고정 / 해제', sub: 'Ctrl+클릭으로 고정', key: 'Ctrl+클릭' },
  { label: '노드 선택', sub: '노드 우클릭 (모바일: 더블탭)', key: '우클릭' },
  { label: '화면 맞춤', sub: '빈 공간 더블클릭 / 더블탭', key: '더블클릭' },
  { label: '화면 확대 / 축소', sub: '마우스 휠 (모바일: 두 손가락)', key: '마우스 휠' },
  { label: '화면 회전', sub: '빈 공간 우클릭 상하 드래그 (모바일: 두 손가락)', key: '우클릭 드래그' },
];
function shortcutKeyOf(r) { return r.action ? formatKey(_shortcuts[r.action]) : r.key; }
function renderShortcutRows() {
  const el = document.getElementById('shortcut-rows');
  if (!el) return;
  el.innerHTML = SHORTCUT_ROWS.map(r =>
    `<div class="settings-row"><div><div class="settings-row-label">${r.label}</div><div class="settings-row-sub">${r.sub}</div></div>`
    + (r.action
      ? `<button class="shortcut-btn" id="sc-${r.action}" onclick="recordShortcut('${r.action}',this)">${formatKey(_shortcuts[r.action])}</button>`
      : `<button class="shortcut-btn fixed-key">${r.key}</button>`)
    + `</div>`).join('');
}
function saveShortcuts() { localStorage.setItem('snlog_shortcuts', JSON.stringify(_shortcuts)); }
function formatKey(k) { return k === ' ' ? 'Space' : k.toUpperCase(); }
function updateShortcutHints() {
  SHORTCUT_ACTIONS.forEach(action => {
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
    if (k.length === 1) { _shortcuts[_recordingFor] = k; saveShortcuts(); updateShortcutHints(); _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(k); _recordingFor = null; _recordingBtn = null;
      if (_legendOpen) renderLegendBody(); } // 열려 있는 도움말의 키 표시도 같이 갱신
    return;
  }
  if (e.key === 'Escape') {
    // 설정창이 떠 있으면 그것만 닫고, 그 외엔 좌측 플라이아웃·우측 패널을 한 번에 닫는다
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (typeof _legendOpen !== 'undefined' && _legendOpen) toggleLegend(); // 범례는 섹션과 별개로 켜지므로 따로 닫는다
    if (_activeRailSection) closeRailFlyout();
    if (detailPanel.classList.contains('open')) hidePanel();
    return;
  }
  const tag = document.activeElement?.tagName;
  // 입력란이나 본문 편집(contenteditable) 중이면 단축키 무시 — 1, 2 등 글자 입력 보장
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === _shortcuts.toggleLabels) { e.preventDefault(); toggleLabels(); }
  else if (k === _shortcuts.toggleConnections) { e.preventDefault(); const cb = document.getElementById('conn-toggle-input'); if (cb) cb.checked = !cb.checked; toggleConnections(); }
  else if (e.key === ' ') { e.preventDefault(); fitGraph(true); } // 스페이스바 → 화면 맞춤
});

// ── 프로필 ────────────────────────────────────────────────────────────

let _profile = {};

async function loadProfile() {
  if (!_savedToken) return;
  try { _profile = await notionFetch({ action: 'profile' }); renderProfile(); } catch(e) {}
}

function renderProfile() {
  const initial = (_profile.name || '?')[0].toUpperCase();
  const initEl = document.getElementById('profile-initial');
  const avatarEl = document.getElementById('profile-avatar');
  if (_profile.avatar) {
    avatarEl.innerHTML = `<img src="${_profile.avatar}" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`;
  } else if (initEl) { initEl.textContent = initial; }
  renderTokenList(); // 프로필이 늦게 와도 목록의 통합 이름이 맞게
}

// ── 설정 모달 ─────────────────────────────────────────────────────────

function openSettings() {
  renderKeyLists(); refreshRoTokenNames(); // 저장된 키 목록 (이름은 열 때 한 번 맞춘다)
  const initial = (_profile.name || '?')[0].toUpperCase();
  const sAvatar = document.getElementById('settings-avatar'), sInitial = document.getElementById('settings-initial');
  if (_profile.avatar) { sAvatar.innerHTML = `<img src="${_profile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`; }
  else if (sInitial) { sInitial.textContent = initial; }
  const sName = document.getElementById('settings-name'), sEmail = document.getElementById('settings-email'), sWs = document.getElementById('settings-workspace');
  // 값이 없으면 줄을 감춘다 — 통합 토큰은 봇 계정이라 이메일이 없어서 대시만 남았다
  const _setLine = (el, v) => { if (!el) return; el.textContent = v || ''; el.style.display = v ? '' : 'none'; };
  _setLine(sName, _profile.name); _setLine(sEmail, _profile.email); _setLine(sWs, _profile.workspace);

  // 저장된 키 표시(마스킹) — 넣었는지 눈으로 확인 가능하게
  const tIn = document.getElementById('settings-token-input');
  if (tIn) { tIn.value = ''; tIn.placeholder = _savedToken ? 'Notion API 저장됨' : '새 토큰 입력...'; }
  const aIn = document.getElementById('settings-aikey-input');
  if (aIn) { aIn.value = ''; aIn.placeholder = _savedAiKey ? 'AI API 저장됨' : 'AIza...'; }

  const localToggle = document.getElementById('s-local-toggle');
  if (localToggle) localToggle.checked = _useLocalStorage;

  ['pages'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) el.checked = _storageScopes[k] !== false; });
  _syncExportSizeBtns();
  SHORTCUT_ACTIONS.forEach(action => { const btn = document.getElementById('sc-' + action); if (btn) btn.textContent = formatKey(_shortcuts[action]); });

  ['shortcuts', 'storage'].forEach(id => {
    const saved = localStorage.getItem('snlog_sec_' + id), body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
    if (!body) return;
    const isOpen = (id === 'storage') ? (saved !== '0') : (saved === '1'); // 저장&캐시는 기본 펼침, 단축키는 기본 접힘
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
  if (_useLocalStorage) { if (_savedToken) localStorage.setItem('snlog_token', _encKey(_savedToken)); if (_savedAiKey) localStorage.setItem('snlog_ai_key', _encKey(_savedAiKey)); saveRoTokens(); }
  else { Object.keys(localStorage).filter(k => k.startsWith('snlog_') && k !== 'snlog_use_local').forEach(k => localStorage.removeItem(k)); }
}

function updateToken() {
  const input = document.getElementById('settings-token-input'), msg = document.getElementById('settings-token-msg');
  const val = input?.value.trim();
  if (!val) { if (msg) { msg.textContent = '토큰 입력 필요'; msg.style.display = 'block'; } return; }
  if (!val.startsWith('secret_') && !val.startsWith('ntn_')) { if (msg) { msg.textContent = '올바른 형식 아님 (secret_ 또는 ntn_)'; msg.style.display = 'block'; } return; }
  _savedToken = val;
  sessionStorage.setItem('snlog_token', _encKey(val));
  if (_useLocalStorage) localStorage.setItem('snlog_token', _encKey(val));
  if (input) { input.value = ''; input.placeholder = 'Notion API 저장됨'; }
  if (msg) { msg.textContent = '저장됨'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  loadProfile(); renderTokenList();
  // 토큰이 바뀌면 접근 가능한 페이지가 통째로 달라진다 → 목록을 바로 다시 받는다
  // (예전엔 이게 없어서 새 토큰을 넣어도 새로고침 전까진 목록이 그대로였다)
  if (typeof initSidebarPageList === 'function') initSidebarPageList();
}

function updateAiKey() {
  const input = document.getElementById('settings-aikey-input'), msg = document.getElementById('settings-aikey-msg');
  const val = input?.value.trim();
  if (!val) { if (msg) { msg.textContent = 'API 키 입력 필요'; msg.style.display = 'block'; } return; }
  _savedAiKey = val;
  renderAiKeyList();
  sessionStorage.setItem('snlog_ai_key', _encKey(val));
  if (_useLocalStorage) localStorage.setItem('snlog_ai_key', _encKey(val));
  if (input) { input.value = ''; input.placeholder = 'AI API 저장됨'; }
  if (msg) { msg.textContent = '저장됨'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
}

function clearCache(type) {
  // 전체 초기화: 노드 모드(색상·배치·연결 표시·회전)·그래프 설정(슬라이더)·페이지·북마크·본문 캐시 등 전부 삭제.
  // 로그인(토큰·AI키)·저장 토글/스코프·언어·단축키·이미지 크기는 유지. 적용된 설정을 확실히 되돌리려 새로고침.
  if (type === 'all') {
    showConfirm('전체 초기화', '노드 모드&그래프 설정 포함 저장 데이터 전체 초기화.\n(로그인&언어&단축키 유지, 새로고침됨)', () => {
      const keep = ['snlog_token','snlog_ro_tokens','snlog_ai_key','snlog_use_local','snlog_scopes','snlog_export_size','snlog_lang','snlog_shortcuts'];
      [...Object.keys(sessionStorage), ...Object.keys(localStorage)]
        .filter(k => k.startsWith('snlog_') && !keep.includes(k))
        .forEach(k => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) {} });
      location.reload();
    }, true);
    return;
  }
  const allKeys = [...Object.keys(sessionStorage), ...Object.keys(localStorage)];
  if (type === 'pages') {
    allKeys.filter(k => k.startsWith('snlog_') && !['snlog_token','snlog_ai_key','snlog_pages','snlog_manual_links','snlog_use_local','snlog_scopes','snlog_export_size','snlog_slider','snlog_search_history'].includes(k))
      .forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); });
    sessionStorage.removeItem('snlog_pages'); localStorage.removeItem('snlog_pages');
  }
  if (type === 'slider') { sessionStorage.removeItem('snlog_slider'); localStorage.removeItem('snlog_slider'); }
  if (type === 'connect') { sessionStorage.removeItem('snlog_manual_links'); localStorage.removeItem('snlog_manual_links'); }
  if (type === 'search') { sessionStorage.removeItem('snlog_search_history'); localStorage.removeItem('snlog_search_history'); }
  const msg = document.getElementById('settings-token-msg');
  if (msg) { msg.textContent = '삭제됨'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 1500); }
}

// AI 대화 기록 삭제 (세션 + 로컬 저장분)
// 사용 기록만 삭제 — AI 대화 · 검색 기록/자주 검색 · 최근 본 노드.
// (수동연결·북마크·페이지·설정 등 실제 데이터는 건드리지 않음)
function clearChatAndRecent() {
  showConfirm('사용 기록 삭제', 'AI 대화&검색 기록&최근 본 노드 기록 전체 삭제.', () => {
    const drop = k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} };
    // AI 대화
    _aiChat = [];
    drop('snlog_aichat');
    if (typeof _renderAiChat === 'function') _renderAiChat();
    // 검색 기록 + 자주 검색하는 키워드 (_searchHistory는 const 배열이라 비우기)
    if (typeof _searchHistory !== 'undefined') _searchHistory.length = 0;
    if (typeof _searchCounts !== 'undefined') _searchCounts = {};
    drop('snlog_search_history'); drop('snlog_search_counts');
    if (typeof renderSearchHistory === 'function') renderSearchHistory();
    if (typeof renderFrequentKeywords === 'function') renderFrequentKeywords();
    // 최근 본 노드(메모리)
    if (typeof _recentNodes !== 'undefined') _recentNodes = [];
    if (typeof renderBookmarkList === 'function') renderBookmarkList();
    toast('사용 기록 삭제됨', { type: 'success' });
  }, true);
}

// 저장된 노션 토큰 삭제 (세션 + 로컬)
// ── 공유받은 읽기 전용 토큰 ───────────────────────────────────────────
// 워크스페이스 이름은 profile 로 확인한다 — 토큰 문자열은 화면에 절대 안 보인다
// 저장된 키 목록 — 노션 토큰·읽기 전용 토큰·AI 키가 같은 행 모양을 쓴다
const _KEY_TRASH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
function _keyRow(name, sub, onRemove, removeTitle) {
  return `<div class="settings-row">
      <div><div class="settings-row-label">${escapeHtml(name)}</div>
      <div class="settings-row-sub">${escapeHtml(sub)}</div></div>
      <button class="s-trash-btn soft" onclick="${onRemove}" title="${escapeHtml(removeTitle)}" aria-label="삭제">${_KEY_TRASH}</button>
    </div>`;
}
function _setList(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

// 키 문자열은 절대 그대로 안 보여준다 — 어느 키인지 가릴 만큼만
const _maskKey = k => k ? '•'.repeat(Math.max(4, String(k).length - 4)) + String(k).slice(-4) : '';

function renderTokenList() {
  _setList('settings-token-list', !_savedToken ? '' : _keyRow(
    (_profile && (_profile.integration || _profile.name)) || '노션 통합',
    ((_profile && _profile.workspace) ? _profile.workspace + ' · ' : '') + '읽기 · 쓰기',
    'clearToken()', '저장된 노션 토큰 삭제'));
}
function renderAiKeyList() {
  _setList('settings-aikey-list', !_savedAiKey ? '' : _keyRow(
    'Gemini API 토큰', _maskKey(_savedAiKey), 'clearAiKey()', '저장된 AI API 키 삭제'));
}
// _pageSrc 에는 그 토큰으로 볼 수 있는 페이지가 전부 들어 있다 —
// 실제로 그래프에 담은 것과 구분해서 보여줘야 지울 때 뭐가 빠지는지 안다
function _roPageCount(id) {
  const all = Object.keys(_pageSrc).filter(k => _pageSrc[k] === id);
  const added = all.filter(k => typeof _addedPageIds !== 'undefined' && _addedPageIds.has(k)).length;
  return '담은 ' + added + '개 · 볼 수 있는 ' + all.length + '개';
}
function renderRoTokens() {
  _setList('ro-token-list', _roTokens.map(t => _keyRow(
    t.name || '이름 확인 중...',
    (t.ws ? t.ws + ' · ' : '') + _roPageCount(t.id),
    `removeRoToken('${t.id}')`, "이 토큰 제거")).join(""));
}
function renderKeyLists() { renderTokenList(); renderAiKeyList(); renderRoTokens(); }
function _roMsg(text) {
  const m = document.getElementById('ro-token-msg');
  if (!m) return;
  m.textContent = text; m.style.display = 'block';
  setTimeout(() => { m.style.display = 'none'; }, 2200);
}
// 이름은 등록할 때 한 번 잡아 저장한다 → 그 뒤 통합 이름이 바뀌거나,
// 예전 코드가 엉뚱한 값을 넣어뒀으면 계속 그게 보인다. 설정을 열 때 한 번 맞춰준다.
let _roNamesChecked = false;
async function refreshRoTokenNames() {
  if (_roNamesChecked || !_roTokens.length) return;
  _roNamesChecked = true;
  let changed = false;
  for (const t of _roTokens) {
    try {
      const prof = await notionFetch({ action: "profile" }, null, t.token);
      const name = (prof && (prof.integration || prof.name)) || t.name;
      const ws = (prof && prof.workspace) || t.ws || "";
      if (name !== t.name || ws !== t.ws) { t.name = name; t.ws = ws; changed = true; }
    } catch (e) {} // 만료·권한 회수면 알던 이름을 그대로 둔다
  }
  if (!changed) return;
  saveRoTokens();
  renderRoTokens();
  if (typeof refreshSidebarRender === 'function') refreshSidebarRender(); // 행 호버 이름도 같이
}

async function addRoToken() {
  const input = document.getElementById('ro-token-input');
  const val = input && input.value.trim();
  if (!val) { _roMsg('토큰 입력 필요'); return; }
  if (!val.startsWith('secret_') && !val.startsWith('ntn_')) { _roMsg('올바른 형식 아님 (secret_ 또는 ntn_)'); return; }
  if (val === _savedToken || _roTokens.some(t => t.token === val)) { _roMsg("이미 등록된 토큰"); return; }
  // 실제로 되는 토큰인지 먼저 확인 — 안 그러면 목록에만 남고 페이지는 영영 안 뜬다
  let name = "", ws = "";
  try {
    const prof = await notionFetch({ action: "profile" }, null, val);
    // 통합 이름이 곧 연결 이름 — 워크스페이스는 같아도 통합마다 다르다
    name = (prof && (prof.integration || prof.name)) || "이름 없는 연결";
    ws = (prof && prof.workspace) || "";
  } catch (e) { _roMsg("토큰 확인 실패 — " + e.message); return; }
  _roTokens.push({ id: "ro" + Date.now().toString(36), token: val, name, ws });
  saveRoTokens();
  if (input) input.value = "";
  renderRoTokens();
  _roMsg(name + " 추가됨");
  if (typeof initSidebarPageList === 'function') initSidebarPageList();
}
function removeRoToken(id) {
  const t = _roTokens.find(x => x.id === id);
  if (!t) return;
  showConfirm("공유 토큰 제거", (t.name || "이 토큰") + " 제거. 담아둔 페이지는 그래프에 남지만 더는 갱신되지 않는다.", () => {
    _roTokens = _roTokens.filter(x => x.id !== id);
    saveRoTokens();
    Object.keys(_pageSrc).forEach(k => { if (_pageSrc[k] === id) delete _pageSrc[k]; });
    renderRoTokens();
    if (typeof initSidebarPageList === 'function') initSidebarPageList();
  }, true);
}

function clearToken() {
  if (!_savedToken) { const m = document.getElementById('settings-token-msg'); if (m) { m.textContent = '저장된 토큰 없음'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); } return; }
  showConfirm('노션 토큰 삭제', '저장된 노션 API 토큰 삭제.', () => {
    _savedToken = '';
    try { sessionStorage.removeItem('snlog_token'); localStorage.removeItem('snlog_token'); } catch (e) {}
    const input = document.getElementById('settings-token-input');
    if (input) { input.value = ''; input.placeholder = '새 토큰 입력...'; }
    const m = document.getElementById('settings-token-msg');
    if (m) { m.textContent = '삭제됨'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); }
    if (typeof loadProfile === 'function') loadProfile(); renderTokenList();
  }, true);
}

// 저장된 AI API 키 삭제 (세션 + 로컬)
function clearAiKey() {
  if (!_savedAiKey) { const m = document.getElementById('settings-aikey-msg'); if (m) { m.textContent = '저장된 키 없음'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); } return; }
  showConfirm('AI API 키 삭제', '저장된 AI API 키 삭제.', () => {
    _savedAiKey = '';
    renderAiKeyList();
    try { sessionStorage.removeItem('snlog_ai_key'); localStorage.removeItem('snlog_ai_key'); } catch (e) {}
    const input = document.getElementById('settings-aikey-input');
    if (input) { input.value = ''; input.placeholder = 'AIza...'; }
    const m = document.getElementById('settings-aikey-msg');
    if (m) { m.textContent = '삭제됨'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); }
  }, true);
}

document.getElementById('settings-modal')?.addEventListener('click', function(e) { if (e.target === this) closeSettings(); });

// ── 슬라이더 복원 ─────────────────────────────────────────────────────

function restoreSlider() {
  const saved = localStorage.getItem('snlog_slider') || sessionStorage.getItem('snlog_slider'); // 항상 localStorage 우선(구 세션값 폴백)
  if (!saved) return;
  try { const { rep, grav, tension, nodeSize, linkWidth, hub } = JSON.parse(saved); if (rep) cfgRep.value = rep; if (grav) cfgGrav.value = grav; if (tension) cfgTension.value = tension; if (nodeSize) cfgNodeSize.value = nodeSize; if (linkWidth) cfgLinkWidth.value = linkWidth; if (hub !== undefined) cfgHub.value = hub; updateConfig(); } catch(e) {}
}

// ── 검색 기록 저장/복원 ───────────────────────────────────────────────

function saveSearchHistory() { snSet('snlog_search_history', JSON.stringify(_searchHistory), 'search'); }
function restoreSearchHistory() {
  const saved = snGet('snlog_search_history', 'search');
  if (!saved) return;
  try { const arr = JSON.parse(saved); arr.forEach(kw => { if (!_searchHistory.includes(kw)) _searchHistory.push(kw); }); renderSearchHistory(); } catch(e) {}
}

// ── 메인 루프 & 초기화 ────────────────────────────────────────────────

restoreSlider(); // 저장된 슬라이더 값을 인풋에 먼저 넣고 → updateConfig가 기본값으로 덮어쓰지 않게
updateConfig();
updateShortcutHints();
setColorScheme(_colorScheme); // 저장된 색상 표현으로 UI 동기화
syncLayoutButtons(); // 저장된 배치 모드로 버튼 동기화
syncClusterToggle(); // 페이지별 나누기 체크 상태도 함께
(() => { const cb = document.getElementById('conn-toggle-input'); if (cb) cb.checked = _showConnections; })(); // 노드 연결 표시 토글 동기화
(() => { const sl = document.getElementById('cfg-label-scale'); if (sl) sl.value = _labelScale; setLabelScale(_labelScale); })();
(() => { const sl = document.getElementById('cfg-depth'); if (sl) sl.value = _depthLimit; setDepthLimit(_depthLimit); })(); // 저장된 표시 깊이 반영
renderPanes();
renderShortcutRows(); // 설정 모달의 조작 목록 (도움말과 같은 배열에서)
applyLegendState();

// 여러 시작 경로(시작 화면 배경 → 노션/MD 시작)에서 loop()가 두 번 불릴 수 있다.
// 가드가 없으면 rAF 체인이 둘 생겨 물리가 프레임당 두 번 돌고 그리기도 두 번 된다.
let _loopRunning = false;
function loop() {
  if (_loopRunning) return;
  _loopRunning = true;
  const tick = () => {
    const k = _simBoost > 0 ? (_simBoost--, 3) : 1; // 전환 직후만 3배속
    for (let i = 0; i < k; i++) simulate();
    draw(); repositionMultiSelectMenu(); updateStatusPath(); requestAnimationFrame(tick);
  };
  tick();
}

// ── 최초 사용 온보딩 (1회) ────────────────────────────────────────────
function dismissOnboarding() {
  const el = document.getElementById('onboarding');
  if (el) el.classList.remove('show');
  try { localStorage.setItem('snlog_onboarded', '1'); } catch (e) {}
}
function showOnboarding() {
  const el = document.getElementById('onboarding');
  if (el) el.classList.add('show');
}
// 로그인/시작 화면이 사라지고 그래프에 들어오면 최초 1회 표시
(function watchOnboarding() {
  try { if (localStorage.getItem('snlog_onboarded') === '1') return; } catch (e) { return; }
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    const ls = document.getElementById('login-screen');
    const hidden = !ls || ls.style.display === 'none' || (window.getComputedStyle && getComputedStyle(ls).display === 'none');
    if (hidden) { clearInterval(iv); setTimeout(showOnboarding, 800); }
    else if (tries > 1200) clearInterval(iv); // 10분 후 포기
  }, 500);
})();

if (_savedToken || sessionStorage.getItem('snlog_pages') || localStorage.getItem('snlog_pages') || localStorage.getItem('snlog_local_pages')) {
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
    restoreSearchHistory(); // 저장해둔 검색 기록 복원
  });
}

// ── 모바일 롱프레스 툴팁 — 터치 기기에선 title 호버가 안 뜨므로 길게 누르면 표시 ──
(function () {
  let _lpTimer = null, _lpStartX = 0, _lpStartY = 0, _lpShown = false;
  const tip = () => document.getElementById('tooltip');
  function show(el, x, y) {
    const t = tip(); if (!t) return;
    const label = el.getAttribute('title') || el.getAttribute('aria-label'); if (!label) return;
    t.textContent = label; t.style.display = 'block';
    // 화면 밖으로 안 나가게 보정
    const w = t.offsetWidth || 120;
    t.style.left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)) + 'px';
    t.style.top = Math.max(8, y - 40) + 'px';
    _lpShown = true;
  }
  function hide() { const t = tip(); if (t) t.style.display = 'none'; _lpShown = false; }
  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest('[title],[aria-label]');
    if (!el || el.closest('#c')) return; // 캔버스는 자체 처리
    const tt = e.touches[0];
    _lpStartX = tt.clientX; _lpStartY = tt.clientY; _lpShown = false;
    _lpTimer = setTimeout(() => { show(el, _lpStartX, _lpStartY); _lpTimer = null; }, 450);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (_lpShown) return; // 이미 뜬 뒤엔 손이 움직여도 유지 (처음 위치에 고정)
    // 뜨기 전 움직임은 스크롤 의도로 보고 취소 (오차 10px 허용)
    if (_lpTimer) {
      const tt = e.touches[0];
      if (Math.abs(tt.clientX - _lpStartX) > 10 || Math.abs(tt.clientY - _lpStartY) > 10) {
        clearTimeout(_lpTimer); _lpTimer = null;
      }
    }
  }, { passive: true });
  const end = () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } hide(); };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();
