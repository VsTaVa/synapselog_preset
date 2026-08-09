// 검색(RAG) — 키워드 추출 → 노드 검색 → 근거로 답변
// ── 임베딩 의미검색 (노드 제목 벡터를 캐시 → 질문과 코사인 유사도) ─────
const _EMBED_MODEL = 'gemini-embedding-001'; // text-embedding-004 은퇴 → 현행 GA 모델
const _EMBED_DIM = 256;
let _titleEmbeds = {}; // titleKey -> number[]
function _titleKey(s) { return (s || '').trim().toLowerCase(); }
function _saveEmbeds() {
  if (!_useLocalStorage) return;
  try {
    const obj = {};
    Object.keys(_titleEmbeds).forEach(k => { obj[k] = _titleEmbeds[k].map(x => Math.round(x * 10000) / 10000); });
    localStorage.setItem('snlog_embeds_v2', JSON.stringify(obj)); // v2: gemini-embedding-001 (구 벡터와 차원/모델 불일치 방지)
  } catch (e) {}
}
(function _restoreEmbeds() {
  try {
    if (!_useLocalStorage) return;
    const s = localStorage.getItem('snlog_embeds_v2'); if (!s) return;
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => { if (Array.isArray(obj[k])) _titleEmbeds[k] = obj[k]; });
  } catch (e) {}
})();
async function _embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${_EMBED_MODEL}:batchEmbedContents?key=${encodeURIComponent(_savedAiKey)}`;
    const body = { requests: chunk.map(t => ({ model: `models/${_EMBED_MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: _EMBED_DIM })) };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const e = new Error('embed HTTP ' + res.status); e.status = res.status; throw e; }
    const data = await res.json();
    (data.embeddings || []).forEach(emb => out.push((emb && emb.values) || null));
  }
  return out;
}
async function _embedOne(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${_EMBED_MODEL}:embedContent?key=${encodeURIComponent(_savedAiKey)}`;
  const body = { model: `models/${_EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: _EMBED_DIM };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const e = new Error('embed HTTP ' + res.status); e.status = res.status; throw e; }
  const data = await res.json();
  return (data.embedding && data.embedding.values) || null;
}
function _cosine(a, b) {
  let dot = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
// 캐시에 없는 제목만 임베딩(증분) → 대상 노드 배열 반환
async function _ensureNodeEmbeds() {
  const targets = (typeof nodes !== 'undefined' ? nodes : []).filter(n => n.visible && !n._aiSummary && n.label && n.label.trim());
  const missing = [...new Set(targets.map(n => n.label.trim()))].filter(t => !_titleEmbeds[_titleKey(t)]);
  if (missing.length) {
    const vecs = await _embedTexts(missing);
    missing.forEach((t, i) => { if (vecs[i] && vecs[i].length) _titleEmbeds[_titleKey(t)] = vecs[i]; });
    _saveEmbeds();
  }
  return targets;
}
// 질문 → 임베딩 → 노드 제목과 코사인 유사도 → 상위 노드. 실패/저유사도면 null(폴백)
async function _semanticSearchNodes(query, topN) {
  if (!_savedAiKey) return null;
  try {
    const targets = await _ensureNodeEmbeds();
    if (!targets.length) return null;
    const qv = await _embedOne(query);
    if (!qv) return null;
    const scored = targets.map(n => { const e = _titleEmbeds[_titleKey(n.label)]; return { n, s: e ? _cosine(qv, e) : -1 }; });
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, topN).filter(x => x.s > 0.25).map(x => x.n);
    return top.length ? top : null;
  } catch (e) { return null; }
}

function _aiAnswerRAG(q) {
  const sel = (_multiSelected || []).slice();
  _aiChatPush('user', q, null, null, sel.length ? sel : null);
  if (sel.length && typeof clearMultiSelect === 'function') clearMultiSelect();
  const waitId = _aiChatPush('ai', _AI_WAIT);
  _aiRun(waitId, _AI_WAIT, async () => {
      // 1순위: 임베딩 의미검색(제목 벡터 캐시). 실패/저유사도면 키워드+부분일치로 폴백
      let matched = await _semanticSearchNodes(q, 6);
      if (!matched) { const searchQuery = await _aiExtractKeywords(q); matched = _aiSearchNodes(searchQuery, 6); }
      if (sel.length) { const ids = new Set(matched.map(n => n.id)); matched = [...sel.filter(n => !ids.has(n.id)), ...matched].slice(0, 8); }
      const context = matched.map((n, i) => {
        const body = nodeBody(n, 500);
        return `[${i + 1}] ${nodeTitle(n)}${body ? '\n' + body : ''}`;
      }).join('\n\n');
      const prompt = context
        ? `너는 SynapseLog(지식 그래프 도구)의 AI 조수야. 한국어로 답해줘.\n- 도구 사용법/기능을 물으면 [도구 안내]를 근거로 답해.\n- 지식 내용을 물으면 [검색된 노드]를 근거로 답하고, 없는 내용은 지어내지 마.\n\n[도구 안내]\n${_SYNAPSE_GUIDE}\n\n[검색된 노드]\n${context}\n\n[질문]\n${q}`
        : `너는 SynapseLog(지식 그래프 도구)의 AI 조수야. 한국어로 답해줘. 관련된 노드는 못 찾았어.\n- 도구 사용법/기능을 묻는 질문이면 [도구 안내]를 근거로 답해.\n- 그 외에는 그래프에 근거가 없다는 점을 밝히고 일반적으로 짧게만 답해.\n\n[도구 안내]\n${_SYNAPSE_GUIDE}\n\n[질문]\n${q}`;
      const ans = await geminiGenerate(prompt);
      _aiChatReplace(waitId, ans, matched);
      if (matched.length && typeof highlightAiNodes === 'function') highlightAiNodes(matched);
  });
}

// AI 답변에서 실제 마크다운만 추출 — ```펜스``` 안을 우선, 없으면 첫 헤딩부터
function _extractMdFromAi(text) {
  const t = (text || '').trim();
  const fence = t.match(/```(?:[\w-]*)\n([\s\S]*?)```/);
  if (fence && /^#{1,6}\s+/m.test(fence[1])) return fence[1].trim();
  const lines = t.split('\n');
  const firstH = lines.findIndex(l => /^#{1,6}\s+/.test(l.trim()));
  if (firstH >= 0) return lines.slice(firstH).join('\n').trim();
  return t;
}

// 대화한 글(가장 최근 AI 답변)을 선택/열린 노드의 하위 노드로 넣기
// 헤딩이 여러 개면 그 계층 구조 그대로 하위 노드들로 반영, 하나면 단일 노드+본문(편집창)
function aiSaveToChild(q) {
  const parent = (_multiSelected.length === 1 ? _multiSelected[0] : null) || (typeof _activeNode !== 'undefined' ? _activeNode : null);
  _aiChatPush('user', q);
  if (!parent) { _aiChatPush('ai', '어느 노드 아래에 넣을지 모름. 먼저 노드를 선택하거나 열기.'); return; }
  if (typeof canAddChild === 'function' && !canAddChild(parent)) { _aiChatPush('ai', '이 노드 아래에는 하위 노드 생성 불가.'); return; }
  const lastAi = [..._aiChat].reverse().find(m => m.role === 'ai' && m.text && !/[⏳]/.test(m.text) && !/^실패|다시 시도|어느 노드|넣을 내용|하위 노드로|하위 노드 생성/.test(m.text));
  if (!lastAi) { _aiChatPush('ai', '넣을 내용 없음. 먼저 AI와 대화해서 글 만들기.'); return; }
  const md = _extractMdFromAi(lastAi.text);
  const headingCount = (md.match(/^#{1,6}\s+/gm) || []).length;
  if (typeof clearMultiSelect === 'function') clearMultiSelect();

  // 헤딩 2개 이상 = 구조 → 계층 하위 노드로 반영 (로컬/MD 노드 대상)
  if (headingCount >= 2 && parent.local) {
    const waitId = _aiChatPush('ai', _AI_WAIT);
    try {
      const newIds = _addEntryChildNodes(parent, md);
      newIds.forEach(id => {
        const c = nodeMap[id];
        if (c) { c.visible = true; c.local = true; c.headingDepth = (parent.headingDepth || 0) + Math.max(1, c.level - parent.level); }
      });
      if (typeof saveLocalPages === 'function') saveLocalPages();
      nodes.forEach(nd => { nd._frozen = false; nd._frozenFrames = 0; });
      isStable = false;
      // MD 파일이면 원본 파일에도 반영
      if (typeof writeBackMdFile === 'function' && String(parent.sourcePageId || '').startsWith('md_')) writeBackMdFile(parent.sourcePageId).catch(() => {});
      if (typeof highlightAiNodes === 'function') highlightAiNodes([parent].concat([...newIds].map(id => nodeMap[id]).filter(Boolean)));
      if (typeof refreshOpenPanes === 'function') refreshOpenPanes();
      _aiChatReplace(waitId, `"${(parent.label || '').trim() || '노드'}" 아래에 ${newIds.size}개 노드로 구조 반영.`, []);
    } catch (e) { _aiChatReplace(waitId, '하위 구조 생성 실패: ' + (e.message || e), []); }
    return;
  }

  // 단일: 첫 헤딩=제목, 나머지=본문 → 한 노드(편집창에서 확인 후 저장)
  const lines = md.split('\n');
  const title = (lines[0] || '').replace(/^#+\s*/, '').replace(/[*_`]/g, '').slice(0, 60).trim() || '새 노드';
  const body = lines.slice(1).join('\n').trim();
  const waitId = _aiChatPush('ai', _AI_WAIT);
  createChildNode(parent, title).then(ids => {
    if (ids && ids.length && nodeMap[ids[0]]) {
      const child = nodeMap[ids[0]];
      openPanel(child);
      const idx = _stack.findIndex(x => x.id === child.id);
      if (idx >= 0 && body) setTimeout(() => { try { beginNodeEdit(idx, child, body); } catch (e) {} }, 150);
      _aiChatReplace(waitId, `"${(parent.label || '').trim() || '노드'}" 아래에 "${title}" 하위 노드로 넣음.${body ? ' 편집창에서 확인 후 저장.' : ''}`, []);
    } else {
      _aiChatReplace(waitId, '하위 노드 생성 실패.', []);
    }
  }).catch(err => _aiChatReplace(waitId, '하위 노드 생성 실패: ' + (err.message || err), []));
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
  if (s) s.textContent = `"${node.label}" 기준 — 연결할 노드 클릭`;
  isStable = false;
}

function multiSelectFocus() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  // 이미 그 노드에 포커스가 걸려 있으면 해제(토글) — 켜는 버튼이 곧 끄는 버튼
  if (_focusMode && _focusNodeId === node.id) {
    _focusMode = false; _focusNodeId = null;
    _activeGlowIds = new Set();
    nodes.forEach(nd => { nd.dimmed = false; });
    isStable = false;
    setTimeout(fitGraph, 50);
    return;
  }
  _isolateActive = false;
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
  else toast('이 노드는 노션 링크 없음 (로컬&MD 노드)', { type: 'error' });
}

function multiSelectAddChild() {
  if (_multiSelected.length !== 1) return;
  const node = _multiSelected[0];
  clearMultiSelect();
  if (!canAddChild(node)) { toast('이 노드에는 하위 노드 생성 불가 (최하위/제한 노드)', { type: 'error' }); return; }
  createChildNode(node, '(제목 없음)').then(ids => { if (ids.length && nodeMap[ids[0]]) openPanel(nodeMap[ids[0]]); toast('하위 노드 추가됨', { type: 'success' }); }).catch(err => toast('하위 노드 추가 실패: ' + (err.message || err), { type: 'error', duration: 5000 }));
}

function multiSelectDelete() {
  if (_multiSelected.length < 1) return;
  if (_multiSelected.length === 1) { const node = _multiSelected[0]; clearMultiSelect(); deleteNodeSmart(node); return; }
  const targets = _multiSelected.slice();
  clearMultiSelect();
  const deletable = targets.filter(canDeleteNode);
  if (!deletable.length) { toast('선택한 노드는 삭제 불가 (페이지&DB 노드는 목록 ✕로)', { type: 'error' }); return; }
  const skipped = targets.length - deletable.length;
  const totalCount = deletable.reduce((s, n) => s + _subtreeIds(n.id).length, 0);
  const hasNotion = deletable.some(n => !n.local);
  const msg = `${deletable.length}개 노드(하위 포함 총 ${totalCount}개) 삭제.`
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

