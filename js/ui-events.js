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
  el.innerHTML = `<div class="rail-subhead">주요 키워드</div><div class="sp-chips">` + kws.map(k => `<button class="sp-chip">${escapeHtml(k)}</button>`).join('') + `</div>`;
  el.style.display = 'block';
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
  if (keyword) {
    const directMatches = new Set();
    nodes.forEach(n => {
      if (!n.visible) return;
      const lt = n.label.toLowerCase(), dt = n.desc.toLowerCase();
      if (lt.includes(keyword) || dt.includes(keyword)) directMatches.add(n.id);
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
    if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = `${directMatches.size}개 결과`; }
  } else {
    clearGraphHighlight();
    if (resultEl) resultEl.style.display = 'none';
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
  }
  if (typeof renderPopularKeywords === 'function') renderPopularKeywords();
  isStable = false;
}
let _searchFitTimer = null;

// AI 근거/추천 노드들을 그래프에서 하이라이트 (검색 하이라이트 메커니즘 재활용)
function highlightAiNodes(nodeList) {
  const arr = (nodeList || []).filter(Boolean);
  if (!arr.length || typeof searchMatches === 'undefined') return;
  applyGraphHighlight(arr.map(n => n && n.id).filter(Boolean), '\uE000', { max: 12, fit: true, fitDelay: 320 }); // 마커=본문에 없는 문자(비면 하이라이트 꺼짐)
}

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
  const parentEdge = getParentEdge(node.id);
  const keep = !!parentEdge && nodeHasChildren(node);
  deleteNodeConfirm(node, keep);
}

// 노드 삭제 진입점 — keepChildren=true면 이 노드만 삭제(하위 보존)
function deleteNodeConfirm(node, keepChildren) {
  if (!node || !canDeleteNode(node)) { toast('이 노드는 삭제할 수 없어요 (페이지·DB 노드는 목록 ✕로)', { type: 'error' }); return; }
  if (keepChildren) {
    const parentEdge = getParentEdge(node.id);
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
  } else if (elapsed < 150 && n && n === mouseDownNode) {
    clearTimeout(_clickTimer); _clickTimer = setTimeout(() => toggleNodePanel(n), 220);
  } else if (elapsed < 150 && !n) {
    clearAllModes();
  }
  if (drag && drag.fixed) saveFixedPositions();
  drag = null; isPanning = false;
});

function clearAllModes() {
  if (typeof searchKeyword !== 'undefined' && searchKeyword) {
    if (typeof searchInput !== 'undefined' && searchInput) searchInput.value = '';
    doSearch(''); // 검색/AI 하이라이트 해제 (배경 클릭 시)
  }
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
    's-aikey':'AI API','s-aikey-sub':'Google AI Studio 제미나이 키. 선택 노드 요약·마크다운 작성에 사용.','s-aikey-ph':'AIza...',
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
    'sc-sel-sub':'노드 우클릭 (모바일: 더블탭)','sc-rightclick':'우클릭','sc-fit-sub2':'스페이스바 · 빈 공간 더블클릭 / 더블탭','sc-dblclick2':'Space · 더블클릭','sc-rotate':'화면 회전','sc-rotate-sub':'빈 공간 우클릭 상하 드래그 (모바일: 두 손가락)','sc-rotate-key':'우클릭 드래그','sc-zoom':'화면 확대 / 축소','sc-zoom-sub':'마우스 휠 (모바일: 두 손가락)','sc-zoom-key':'마우스 휠',
    's-local-warn':'⚠ API 토큰이 이 기기의 브라우저에 저장됩니다. 공용 컴퓨터에서는 사용을 권장하지 않습니다.',
    's-storage':'저장 & 캐시','s-local':'로컬 저장 사용','s-local-sub':'⚠ 로컬 저장시 토큰이 브라우저에 저장. 공용 기기 주의.',
    's-page-cache':'페이지 캐시','s-page-cache-sub':'불러온 노션 페이지 내용',
    's-connect-cache':'연결 모드 캐시','s-connect-cache-sub':'수동 연결 엣지',
    's-all-cache':'전체 캐시','s-aihist':'AI 대화 기록','s-clear-hist':'대화·최근 기록','s-clear-hist-sub':'AI 대화·최근 본 노드만 삭제','s-del':'삭제','s-del-all':'전체 삭제','s-close-btn':'닫기',
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
    'sc-sel-sub':'Right-click node (mobile: double-tap)','sc-rightclick':'Right-click','sc-fit-sub2':'Spacebar · double-click empty space / double-tap','sc-dblclick2':'Space · Double-click','sc-rotate':'View Rotation','sc-rotate-sub':'Right-drag empty space up/down (mobile: two fingers)','sc-rotate-key':'Right-drag','sc-zoom':'Zoom In / Out','sc-zoom-sub':'Mouse wheel (mobile: pinch)','sc-zoom-key':'Mouse wheel',
    's-local-warn':'⚠ API token is stored in this browser. Not recommended on shared computers.',
    's-storage':'Storage & Cache','s-local':'Use Local Storage','s-local-sub':'⚠ API token is stored in this device\'s browser. Not recommended on shared devices.',
    's-page-cache':'Page Cache','s-page-cache-sub':'Loaded Notion page content',
    's-connect-cache':'Connect Cache','s-connect-cache-sub':'Manual edge connections',
    's-all-cache':'All Cache','s-aihist':'AI Chat History','s-clear-hist':'Chat & Recent','s-clear-hist-sub':'Clears AI chat & recent nodes only','s-del':'Delete','s-del-all':'Delete All','s-close-btn':'Close',
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

// AI 대화 기록 삭제 (세션 + 로컬 저장분)
function clearAiHistory() {
  showConfirm('AI 대화 기록 삭제', 'AI 대화 기록을 모두 지울까요?', () => {
    _aiChat = [];
    try { localStorage.removeItem('snlog_aichat'); } catch (e) {}
    if (typeof _renderAiChat === 'function') _renderAiChat();
    toast('AI 대화 기록을 지웠어요', { type: 'success' });
  }, true);
}

// 대화·최근 기록만 삭제 — AI 대화 + 최근 본 노드. (수동연결·북마크·페이지 등은 건드리지 않음)
function clearChatAndRecent() {
  showConfirm('대화·최근 기록 삭제', 'AI 대화와 최근 본 노드 기록을 지울까요?', () => {
    _aiChat = [];
    try { localStorage.removeItem('snlog_aichat'); sessionStorage.removeItem('snlog_aichat'); } catch (e) {}
    if (typeof _renderAiChat === 'function') _renderAiChat();
    if (typeof _recentNodes !== 'undefined') _recentNodes = []; // 최근 본 노드는 메모리에만 존재 → 직접 초기화
    if (typeof renderBookmarkList === 'function') renderBookmarkList();
    toast('AI 대화·최근 기록을 지웠어요', { type: 'success' });
  }, true);
}

// 저장된 노션 토큰 삭제 (세션 + 로컬)
function clearToken() {
  if (!_savedToken) { const m = document.getElementById('settings-token-msg'); if (m) { m.textContent = '저장된 토큰이 없어요'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); } return; }
  showConfirm('노션 토큰 삭제', '저장된 노션 API 토큰을 지울까요?', () => {
    _savedToken = '';
    try { sessionStorage.removeItem('snlog_token'); localStorage.removeItem('snlog_token'); } catch (e) {}
    const input = document.getElementById('settings-token-input');
    if (input) { input.value = ''; input.placeholder = t('sc-placeholder-token') || '새 토큰 입력...'; }
    const m = document.getElementById('settings-token-msg');
    if (m) { m.textContent = '삭제됐어요'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); }
    if (typeof loadProfile === 'function') loadProfile();
  }, true);
}

// 저장된 AI API 키 삭제 (세션 + 로컬)
function clearAiKey() {
  if (!_savedAiKey) { const m = document.getElementById('settings-aikey-msg'); if (m) { m.textContent = '저장된 키가 없어요'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); } return; }
  showConfirm('AI API 키 삭제', '저장된 AI API 키를 지울까요?', () => {
    _savedAiKey = '';
    try { sessionStorage.removeItem('snlog_ai_key'); localStorage.removeItem('snlog_ai_key'); } catch (e) {}
    const input = document.getElementById('settings-aikey-input');
    if (input) { input.value = ''; input.placeholder = 'AIza...'; }
    const m = document.getElementById('settings-aikey-msg');
    if (m) { m.textContent = '삭제됐어요'; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 1500); }
  }, true);
}

document.getElementById('settings-modal')?.addEventListener('click', function(e) { if (e.target === this) closeSettings(); });

// ── 슬라이더 복원 ─────────────────────────────────────────────────────

function restoreSlider() {
  const saved = localStorage.getItem('snlog_slider') || sessionStorage.getItem('snlog_slider'); // 항상 localStorage 우선(구 세션값 폴백)
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

restoreSlider(); // 저장된 슬라이더 값을 인풋에 먼저 넣고 → updateConfig가 기본값으로 덮어쓰지 않게
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
  });
}
