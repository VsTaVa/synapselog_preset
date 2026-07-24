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
  renderDetailRail();
  _autoFitPanel();
}

// 우측 레일: 최근 본 노드 최대 5개를 노드색 원으로 세로 배치(아래=최신). 열린 패널 노드는 글로우.
// 패널이 열려 있거나 접혀 있을 때(탭이 있으면) 표시 — 접히면 화면 우측 끝에 도킹.
let _railNewestId = null;
function renderDetailRail() {
  const rail = document.getElementById('detail-rail');
  if (!rail) return;
  const openIds = new Set(_stack.map(x => x.id)); // 현재 열린 패널(최대 2) = 활성(글로우)
  // _recentNodes는 최신이 앞 → 위=최신, 아래=오래된
  const recents = (typeof _recentNodes !== 'undefined' ? _recentNodes : [])
    .map(id => nodeMap[id]).filter(n => n && n.visible).slice(0, 5);
  const show = recents.length > 0; // 패널과 무관하게 최근 노드가 있으면 레일 표시
  rail.classList.toggle('open', show);
  if (!show) { rail.innerHTML = ''; _railNewestId = null; return; }
  const newest = recents.length ? recents[0] : null; // 최신 = 맨 위
  const enterId = (newest && newest.id !== _railNewestId) ? newest.id : null; // 새로 등장한 것만 아래→위 등장
  // FLIP: 새 원이 아래에 들어올 때 기존 원들도 위로 미끄러지게 — 재렌더 전 위치 기록
  const prevY = {};
  rail.querySelectorAll('.dr-dot').forEach(d => { prevY[d.dataset.nid] = d.getBoundingClientRect().top; });
  rail.innerHTML = recents.map(n => {
    const c = (typeof nodeRgb === 'function' && nodeRgb(n)) || [237, 112, 0];
    const t = escapeHtml((n.label || '(제목 없음)').trim());
    const cls = 'dr-dot' + (openIds.has(n.id) ? ' active' : '') + (n.id === enterId ? ' enter' : '');
    return `<button class="${cls}" data-nid="${n.id}" style="--dot:rgb(${c[0]},${c[1]},${c[2]})" aria-label="${t}"><span class="dr-label">${t}</span></button>`;
  }).join('');
  // 기존 원들: 옛 위치 → 새 위치로 슬라이드 (WAAPI라 인라인 스타일 안 남김, 호버 유지)
  rail.querySelectorAll('.dr-dot').forEach(d => {
    const nid = d.dataset.nid;
    if (nid in prevY && d.animate) {
      const dy = prevY[nid] - d.getBoundingClientRect().top;
      if (dy) d.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 340, easing: 'cubic-bezier(0.34,1.2,0.5,1)' });
    }
  });
  _railNewestId = newest ? newest.id : null;
  rail.querySelectorAll('.dr-dot').forEach(d => {
    d.onclick = () => {
      const n = nodeMap[d.dataset.nid]; if (!n) return;
      _detailPanelCollapsed = false; // 접혀 있으면 펼치면서 열기
      openPanel(n);
      if (typeof focusViewOnNode === 'function') focusViewOnNode(n);
    };
  });
}

function reopenDetailPanel() {
  if (!anyTabs()) return;
  if (detailPanel.classList.contains('open')) { _detailPanelCollapsed = false; detailPanel.classList.remove('panel-collapsed'); }
  else { showPanel(); }
  updateDetailReopenTab();
  renderDetailRail();
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
      `<div class="detail-header">` +
        `<div class="detail-title"></div>` +
        `<div class="detail-header-actions">` +
          (_stack.length >= 2 ? `<button class="pane-swap-btn" title="위·아래 패널 교체"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V5M7 5 4 8M7 5l3 3"/><path d="M17 3v16M17 19l3-3M17 19l-3-3"/></svg></button>` : '') +
          `<button class="pane-collapse-btn" title="패널 접기">${_paneCollapseIcon}</button>` +
          `<button class="pane-x" title="닫기">✕</button>` +
        `</div>` +
      `</div>` +
      `<div class="detail-body">` +
        `<div class="detail-meta-row"><span class="detail-date"></span></div>` +
        `<div class="detail-content"></div>` +
      `</div>`;
    const swb = el.querySelector('.pane-swap-btn');
    if (swb) swb.onclick = (e) => { e.stopPropagation(); swapPanes(); };
    el.querySelector('.pane-collapse-btn').onclick = (e) => { e.stopPropagation(); toggleDetailPanel(); };
    el.querySelector('.pane-x').onclick = (e) => { e.stopPropagation(); closePaneAt(i); };
    wrap.appendChild(el);
    renderPaneContent(i, node);
  });
  renderDetailRail();
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
  const headerEl = paneEl.querySelector('.detail-header');
  if (!n) {
    if (titleEl) titleEl.textContent = '';
    if (dateEl) dateEl.style.display = 'none';
    if (contentEl) contentEl.innerHTML = '';
    const oldLink = headerEl && headerEl.querySelector('.detail-notion-link');
    if (oldLink) oldLink.style.display = 'none';
    return;
  }
  if (titleEl) { titleEl.textContent = n.label; titleEl.title = n.label; }
  if (dateEl) {
    if (n.date) { dateEl.style.display = 'inline'; dateEl.textContent = n.date; }
    else { dateEl.style.display = 'none'; }
  }
  // 노션에서 보기 / 북마크는 설정(⚙) 메뉴로 이동 — 예전 직접 아이콘이 남아있으면 제거
  headerEl.querySelectorAll('.detail-notion-link, .detail-bookmark-btn').forEach(el => el.remove());
  // 노션에서 보기 링크 대상 (로컬/MD 노드는 없음)
  const isLocalLike = n.local || String(n.sourcePageId || '').startsWith('md_');
  // 노드 연결 링크와 동일하게 페이지ID 포함(notion.so/<page>?pvs=4#<block>) → 페이지 이동+블록 스크롤
  const notionHref = isLocalLike ? '' : _wikiUrlFor(n);

  const headerActions = headerEl.querySelector('.detail-header-actions');
  // AI 요약 가짜 노드는 톱니(수정·동기화·삭제 등) 없이 본문만 표시
  if (!n._aiSummary) {
  // 모든 동작(수정·동기화·하위추가·노션보기·북마크·삭제)을 ⚙ 메뉴 하나로 통합
  let setBtn = headerEl.querySelector('.detail-settings-btn');
  if (!setBtn) {
    setBtn = document.createElement('button');
    setBtn.className = 'detail-edit-btn detail-settings-btn';
    setBtn.title = '메뉴';
    setBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    // ⚙은 액션 묶음 맨 앞(접기·닫기 왼쪽)
    headerActions.insertBefore(setBtn, headerActions.firstChild);
  }
  setBtn.onclick = (e) => { e.stopPropagation(); toggleDetailSettings(setBtn, i, n, notionHref); };
  }

  let rawDesc = escapeHtml(n.desc || '(내용 없음)')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="wl-code">$1</code>')
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  // 목록 마커(줄머리만) — "- "/"* "는 노션처럼 원(•)으로, 번호는 그대로. 편집기의 _listMark와 동일한 표기
  rawDesc = rawDesc.replace(/^(\s*)(\d+\.|[-*])(\s)/gm,
    (m, sp, mk, tail) => `${sp}<span class="md-mark">${/^\d/.test(mk) ? mk : '•'}</span>${tail}`);
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
  if (searchKeyword && searchKeyword.trim() && searchMatches.has(n.id)) {
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
  node.bodyBlocks = lines.map(b => ({ id: b.id, text: bodyBlockText(b.line), mark: _listMark(b.line) }));
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
  const canAdd = typeof canAddChild === 'function' && canAddChild(n);
  const canDel = typeof canDeleteNode === 'function' && canDeleteNode(n);
  const editItem = canEdit ? `<button data-act="edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> 제목·본문 수정</button>` : '';
  const addItem = canAdd ? `<button data-act="add"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><path d="M11 7.4V13a3 3 0 0 1-3 3H7.4"/><path d="M16 18h6M19 15v6"/></svg> 하위 노드 추가</button>` : '';
  const delItem = canDel ? `<button data-act="delete" class="danger">${trashSvg} 노드 삭제</button>` : '';
  const aiActItem = `<button data-act="aiact"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg> AI 작업</button>`;
  const sep = (a, b) => (a && b) ? '<div class="ds-sep"></div>' : '';
  const topGroup = editItem + addItem;
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
// 편집기 안에서도 검색 키워드를 강조 — 텍스트 노드만 감싸므로 태그·href가 깨지지 않고,
// markdownFromHtml이 모르는 태그(<mark>)는 텍스트만 남기고 벗겨내므로 저장에 영향 없음
function markKeywordInEl(el, kw) {
  const needle = (kw || '').trim().toLowerCase();
  if (!el || !needle) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let tn;
  while ((tn = walker.nextNode())) {
    if (tn.nodeValue && tn.nodeValue.toLowerCase().includes(needle)) targets.push(tn);
  }
  targets.forEach(t => {
    const val = t.nodeValue, lower = val.toLowerCase();
    const frag = document.createDocumentFragment();
    let idx = 0, at;
    while ((at = lower.indexOf(needle, idx)) !== -1) {
      if (at > idx) frag.appendChild(document.createTextNode(val.slice(idx, at)));
      const m = document.createElement('mark');
      m.textContent = val.slice(at, at + needle.length);
      frag.appendChild(m);
      idx = at + needle.length;
    }
    if (idx < val.length) frag.appendChild(document.createTextNode(val.slice(idx)));
    t.parentNode.replaceChild(frag, t);
  });
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
    const pe = getParentEdge(cur);
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
  let _bodyTouchOver = null; // 모바일 터치 드래그 중 위에 올라간 행
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
    if (typeof searchKeyword !== 'undefined') markKeywordInEl(ce, searchKeyword); // 검색 중이면 편집기에서도 키워드 강조
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
      // 모바일: HTML5 드래그앤드롭은 터치에서 동작하지 않아 터치 이벤트로 같은 동작을 구현
      const _touchClear = () => {
        item.classList.remove('dragging');
        if (_bodyTouchOver) _bodyTouchOver.classList.remove('drag-over');
        _bodyTouchOver = null; _bodyDrag = null;
      };
      handle.addEventListener('touchstart', e => {
        e.preventDefault(); // 스크롤·텍스트 선택 방지
        _bodyDrag = rowObj; _bodyTouchOver = null;
        item.classList.add('dragging');
      }, { passive: false });
      handle.addEventListener('touchmove', e => {
        if (!_bodyDrag) return;
        e.preventDefault();
        const t = e.touches[0]; if (!t) return;
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const over = under && under.closest ? under.closest('.body-edit-item') : null;
        if (_bodyTouchOver && _bodyTouchOver !== over) _bodyTouchOver.classList.remove('drag-over');
        if (over && over !== item) { over.classList.add('drag-over'); _bodyTouchOver = over; }
        else _bodyTouchOver = null;
      }, { passive: false });
      handle.addEventListener('touchend', e => {
        e.preventDefault();
        if (_bodyDrag && _bodyTouchOver) {
          const target = rows.find(r => r.item === _bodyTouchOver);
          if (target) reorderBodyRow(_bodyDrag, target);
        }
        _touchClear();
      }, { passive: false });
      handle.addEventListener('touchcancel', _touchClear);
    }
    if (blk && blk.mark) { const mk = document.createElement('span'); mk.className = 'body-edit-mark'; mk.contentEditable = 'false'; mk.textContent = blk.mark; item.appendChild(mk); }
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
// 그래프 설정 세부(슬라이더) 토글
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
    const pe = getParentEdge(cur);
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
  // 최근 본 노드 추적(우측 레일·노드 섹션) + '자주 본 노드' 집계는 실제 열 때만
  if (n && n.id) {
    if (typeof bumpNodeView === 'function') bumpNodeView(n);
    if (typeof addRecentNode === 'function') addRecentNode(n);
  }
  const _wasOpen = detailPanel.classList.contains('open');
  // 스택에 없으면 아래(최신)에 추가, 2개 넘치면 맨 위(가장 오래된) 제거
  let added = false;
  if (!_stack.some(x => x.id === n.id)) {
    _stack.push(n);
    if (_stack.length > MAX_STACK) _stack.shift();
    added = true;
  }
  // 사용자가 패널을 접어둔 상태면 노드를 눌러도 펼치지 않음 — 내용만 갱신하고 '열기' 버튼으로만 펼침
  if (_detailPanelCollapsed) {
    detailPanel.classList.add('open', 'panel-collapsed');
    renderPanes(added ? n.id : null);
    updateDetailReopenTab();
    return;
  }
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

