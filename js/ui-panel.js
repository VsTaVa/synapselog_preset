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

// 상하 분할 시 위 패널이 차지하는 비율(0~1). 갤럭시 화면분할처럼 경계선 드래그로 조절
let _paneRatio = 0.5;
function _applyPaneRatio() {
  const wrap = document.getElementById('detail-panes');
  if (!wrap || !wrap.classList.contains('split')) return;
  const panes = wrap.querySelectorAll('.detail-pane');
  if (panes.length >= 2) {
    panes[0].style.flex = `${_paneRatio} 1 0`;
    panes[1].style.flex = `${1 - _paneRatio} 1 0`;
  }
  const dv = wrap.querySelector('.pane-divider');
  if (dv) dv.style.top = (_paneRatio * 100) + '%';
}
// 경계선 조작: 드래그=크기조절, 짧은 탭(움직임<5px)=위·아래 전환 팝업. 드래그 동안만 document 리스너를 달았다 뗀다(누적 방지)
function _startPaneDrag(e, dv) {
  const wrap = document.getElementById('detail-panes');
  if (!wrap) return;
  const avail = wrap.clientHeight;
  if (avail <= 0) return;
  const startY = e.touches ? e.touches[0].clientY : e.clientY;
  const startX = e.touches ? e.touches[0].clientX : e.clientX;
  const startRatio = _paneRatio;
  const minR = Math.min(0.35, 64 / avail); // 한쪽이 최소 64px는 남게
  let moved = false;
  document.body.classList.add('resizing-panes');
  dv.classList.add('dragging');
  const move = (ev) => {
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    if (!moved && (Math.abs(y - startY) > 5 || Math.abs(x - startX) > 5)) moved = true;
    if (moved) {
      const r = startRatio + (y - startY) / avail;
      _paneRatio = Math.max(minR, Math.min(1 - minR, r));
      _applyPaneRatio();
    }
    if (ev.cancelable) ev.preventDefault();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchend', up);
    document.body.classList.remove('resizing-panes');
    dv.classList.remove('dragging');
    if (!moved) swapPanes(); // 탭 → 위·아래 바로 전환
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('mouseup', up);
  document.addEventListener('touchend', up);
  if (e.cancelable) e.preventDefault();
}

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
          `<button class="pane-x" title="닫기">✕</button>` +
        `</div>` +
      `</div>` +
      `<div class="detail-body">` +
        `<div class="detail-meta-row"><span class="detail-date"></span></div>` +
        `<div class="detail-content"></div>` +
      `</div>`;
    el.querySelector('.pane-x').onclick = (e) => { e.stopPropagation(); closePaneAt(i); };
    wrap.appendChild(el);
    renderPaneContent(i, node);
  });
  // 상하 분할이면 경계선 위에 얇은 드래그 핸들을 띄워 비율 조절 (패널은 계속 맞닿음)
  if (_stack.length >= 2) {
    const dv = document.createElement('div');
    dv.className = 'pane-divider';
    dv.title = '드래그하여 위&아래 패널 크기 조절';
    dv.innerHTML = `<span class="pane-divider-grip"></span>`;
    dv.addEventListener('mousedown', e => _startPaneDrag(e, dv));
    dv.addEventListener('touchstart', e => _startPaneDrag(e, dv), { passive: false });
    wrap.appendChild(dv);
    _applyPaneRatio();
  }
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
  // 제목은 기존 노드칩 컴포넌트 그대로 사용(색·북마크 표식·클릭 이동 포함)
  if (titleEl) { titleEl.innerHTML = (typeof createNodeChip === 'function') ? createNodeChip(n, { maxLen: 30, className: 'node-chip--lg' }) : escapeHtml(n.label); titleEl.title = n.label; }
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
  // 콜아웃/인용보다 먼저 — 그쪽이 줄 끝 개행을 먹으면 다음 줄의 ^ 앵커가 깨진다
  rawDesc = rawDesc.replace(/^(\s*)(\d+\.|[-*])(\s)/gm,
    (m, sp, mk, tail) => `${sp}<span class="md-mark">${/^\d/.test(mk) ? mk : '•'}</span>${tail}`);
  // 콜아웃(>>) — 인용과 동일 방식: 붙어 있는 여러 줄을 하나로 묶어 세로선 스타일 블록으로.
  // 인용(>)보다 먼저 처리('>>'가 '>'로 잘못 잡히지 않게)
  rawDesc = rawDesc.replace(/(?:^[ \t]*&gt;&gt;[ \t]+.*(?:\n|$))+/gm, (block) => {
    const txt = block.replace(/\n$/, '').split('\n')
      // '>>'를 뗀 뒤 남는 목록 마커도 바깥 본문과 같이 •/숫자로 — 위 목록 치환은 줄머리가
      // '>>'라 그냥 지나쳐서, 콜아웃 안 불릿만 '-'가 날것으로 보였다
      .map(l => l.replace(/^[ \t]*&gt;&gt;[ \t]+/, '')
                 .replace(/^(\s*)(\d+\.|[-*])(\s)/, (m, sp, mk, tail) => `${sp}<span class="md-mark">${/^\d/.test(mk) ? mk : '•'}</span>${tail}`))
      .join('\n');
    return `<span class="md-callout">${txt}</span>`;
  });
  // 인용(>) — 붙어 있는 여러 줄을 인용 하나로 묶는다. 줄마다 따로 감싸면 소프트 줄바꿈이 있는
  // 인용의 둘째 줄이 세로선 밖으로 떨어져 나갔음. 줄 끝 개행까지 먹어야 pre-wrap에서 빈 줄이 안 생긴다
  rawDesc = rawDesc.replace(/(?:^[ \t]*&gt;[ \t]+.*(?:\n|$))+/gm, (block) => {
    const txt = block.replace(/\n$/, '').split('\n')
      .map(l => l.replace(/^[ \t]*&gt;[ \t]+/, '')).join('\n');
    return `<span class="md-quote">${txt}</span>`;
  });
  // 구분선(--- 만 있는 줄) → 가로줄. 줄 끝 개행까지 먹어 아래에 빈 줄이 안 생기게(위아래 간격 = hr margin으로 대칭)
  rawDesc = rawDesc.replace(/^[ \t]*---+[ \t]*\n?/gm, '<hr class="md-hr">');
  // 화살표(-> 또는 →)도 주황색 (escapeHtml 후 > 는 &gt;)
  rawDesc = rawDesc.replace(/(-&gt;|→)/g, '<span style="color:#ed7000;">$1</span>');
  // [텍스트](url) → 링크. 노드로 해석되면 내부 이동, 아니면 외부 링크. (원문 이스케이프됨: & 는 &amp;)
  rawDesc = rawDesc.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (mm, txt, url) => {
    const decUrl = url.replace(/&amp;/g, '&');
    const target = (typeof _nodeFromLinkUrl === 'function') ? _nodeFromLinkUrl(decUrl) : null;
    // 보기 모드에서만 칩(🔗 + 제목만, URL 숨김). 편집 모드는 원문 그대로 보여준다
    if (target) return `<span class="wl-ref wl-chip" data-nid="${target.id}" style="${_chipColorStyle(target)}">${txt}</span>`;
    return `<a class="wl-ref wl-chip wl-ext" href="${url}" target="_blank" rel="noopener">${txt}</a>`;
  });
  if (searchKeyword && searchKeyword.trim() && searchMatches.has(n.id)) {
    const re = _kwRegex(searchKeyword); // 띄어쓰기 무시 매칭
    if (re) rawDesc = rawDesc.replace(re, '<mark style="background:rgba(237,112,0,0.35);color:#ed7000;border-radius:3px;padding:0 2px;">$1</mark>');
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
  // 서식 살린 제목은 편집·저장용으로 따로 보관(라벨은 평문 유지 — 검색·노드 매칭이 이걸 씀)
  node.labelMd = (data.titleMd || '').trim() || newTitle;
  if (typeof data.toggleable === 'boolean' && !!data.toggleable !== !!node.notionToggle) node.notionToggle = !!data.toggleable;
  const lines = Array.isArray(data.body) ? data.body : [];
  // type/checked는 서버가 준 노션 블록 실제 값 우선 — 콜아웃은 줄머리 마커가 없어 추정이 불가능하다
  node.bodyBlocks = lines.map(b => ({
    id: b.id, text: bodyBlockText(b.line), mark: _listMark(b.line),
    type: b.type || _blockTypeOf(b.line),
    checked: typeof b.checked === 'boolean' ? b.checked : _blockChecked(b.line),
    nested: !!b.nested // 중첩 블록 — 편집에서 이동(재정렬/중간삽입) 금지, 텍스트 수정만
  }));
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
  const editItem = canEdit ? `<button data-act="edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> 제목&본문 수정</button>` : '';
  const addItem = canAdd ? `<button data-act="add"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><path d="M11 7.4V13a3 3 0 0 1-3 3H7.4"/><path d="M16 18h6M19 15v6"/></svg> 하위 노드 추가</button>` : '';
  const delItem = canDel ? `<button data-act="delete" class="danger">${trashSvg} 노드 삭제</button>` : '';
  const aiActItem = `<button data-act="aiact"><span class="menu-ic-txt">AI</span> AI 노드 선택</button>`;
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
// 링크는 칩으로 바꾸지 않는다 — 편집 모드에서는 [텍스트](url) / [[노트#헤딩]] 원문 그대로 보여야
// 링크를 직접 고치거나 지울 수 있다(보기 모드에서만 칩으로 렌더)
function htmlFromMarkdown(t) {
  return escapeHtml(t || '')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
}
// 편집기 안에서도 검색 키워드를 강조 — 텍스트 노드만 감싸므로 태그·href가 깨지지 않고,
// markdownFromHtml이 모르는 태그(<mark>)는 텍스트만 남기고 벗겨내므로 저장에 영향 없음
function markKeywordInEl(el, kw) {
  const re = _kwRegex(kw); // 띄어쓰기 무시 매칭
  if (!el || !re) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let tn;
  while ((tn = walker.nextNode())) {
    re.lastIndex = 0;
    if (tn.nodeValue && re.test(tn.nodeValue)) targets.push(tn);
  }
  targets.forEach(t => {
    const val = t.nodeValue;
    const frag = document.createDocumentFragment();
    let idx = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(val)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; } // 빈 매치 방지
      if (m.index > idx) frag.appendChild(document.createTextNode(val.slice(idx, m.index)));
      const mk = document.createElement('mark');
      mk.textContent = m[0];
      frag.appendChild(mk);
      idx = m.index + m[0].length;
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
  // 이동 금지 대상은 '노드 전체'가 아니라 '해당 줄'만 — 예전엔 콜아웃이 하나라도 있으면
  // 그 노드의 평범한 문단·불릿까지 전부 못 옮겼다.
  //  · 중첩 블록(콜아웃 안): 옮기면 최상위로 재생성돼 콜아웃 밖으로 튀어나감
  //  · 콜아웃 본체: 재생성+삭제하면 자식이 함께 보관돼 사라짐
  // 단, 앵커가 없는 부모(토글 헤딩·페이지 직속)는 정밀 이동이 안 돼 '전부 재생성' 폴백을 타는데
  // 그 폴백은 중첩 구조를 부수므로, 그 조합에서만 예전처럼 전면 금지.
  const _bb = (!isLocal && node.bodyBlocks) || [];
  const _tgtPre = (!isLocal && node.notionBlockId) ? _appendTarget(node) : null;
  const lockAllRows = !isLocal && _bb.some(b => b.nested) && !(_tgtPre && _tgtPre.afterId);
  const lockedIds = new Set();
  _bb.forEach((b, i) => {
    if (b.nested) lockedIds.add(b.id);
    else if (_bb[i + 1] && _bb[i + 1].nested) lockedIds.add(b.id); // 자식을 가진 콜아웃 본체
  });
  if (!hasTitle && !hasBody && !canAdd) return;
  if (!contentEl) return;

  let titleInput = null;
  // 제목도 본문 행과 같은 마크다운 편집기 — 예전엔 평문 <input>이라 저장할 때마다
  // 헤딩의 볼드·링크가 통째로 날아갔다. 원본 서식은 labelMd(동기화 때 서버가 준 값)에 있음
  const titleMd = () => (!isLocal && node.labelMd) ? node.labelMd : node.label;
  if (hasTitle && titleEl) {
    titleEl.innerHTML = '';
    titleInput = document.createElement('div');
    titleInput.className = 'detail-title-input detail-title-ce';
    titleInput.contentEditable = 'true';
    titleInput.innerHTML = htmlFromMarkdown(titleMd());
    attachFormatting(titleInput); // Ctrl+B/I/U(취소선)/E + 선택 시 서식 툴바
    titleEl.appendChild(titleInput);
  }
  const titleValue = () => titleInput ? markdownFromHtml(titleInput).replace(/\s*\n\s*/g, ' ').trim() : null;

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
  const addRow = (text, blk, afterRow, newType) => {
    const item = document.createElement('div'); item.className = 'body-edit-item';
    const ce = document.createElement('div');
    ce.className = 'body-edit-row'; ce.contentEditable = 'true';
    ce.innerHTML = htmlFromMarkdown(text);
    if (typeof searchKeyword !== 'undefined') markKeywordInEl(ce, searchKeyword); // 검색 중이면 편집기에서도 키워드 강조
    if (!blk) ce.dataset.placeholder = '본문 내용…';
    const rowObj = { blk: blk || null, el: ce, item, orig: text || '', isNew: !blk, type: (blk && blk.type) || (newType && newType.type) || '', checked: blk ? !!blk.checked : !!(newType && newType.checked), nested: !!(blk && blk.nested) };
    // 이 줄이 이동 금지인가 (중첩 블록 / 자식 가진 콜아웃 본체 / 앵커 없는 부모의 중첩 노드)
    rowObj.locked = lockAllRows || !!(blk && blk.id && lockedIds.has(blk.id));
    // 드래그 핸들 — 이동 금지 줄에는 안 붙인다(로컬 단일 본문은 순서 개념 자체가 없음)
    if (!isLocal && !rowObj.locked) {
      const handle = document.createElement('span'); handle.className = 'body-edit-handle'; handle.textContent = '⠿'; handle.draggable = true;
      handle.addEventListener('dragstart', e => { _bodyDrag = rowObj; item.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      handle.addEventListener('dragend', () => { item.classList.remove('dragging'); _bodyDrag = null; list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over')); });
      item.appendChild(handle);
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
        const overRow = over ? rows.find(r => r.item === over) : null;
        if (over && over !== item && overRow && !overRow.nested) { over.classList.add('drag-over'); _bodyTouchOver = over; }
        else _bodyTouchOver = null;
      }, { passive: false });
      handle.addEventListener('touchend', e => {
        e.preventDefault();
        if (_bodyDrag && _bodyTouchOver) {
          const target = rows.find(r => r.item === _bodyTouchOver);
          if (target && !target.nested) reorderBodyRow(_bodyDrag, target);
        }
        _touchClear();
      }, { passive: false });
      handle.addEventListener('touchcancel', _touchClear);
    }
    // 놓을 자리(드롭 대상)는 핸들과 별개 — 콜아웃 본체는 못 옮겨도 '그 앞에 놓기'는 돼야 한다.
    // 반면 중첩 줄은 대상에서 뺀다: 콜아웃 자식 사이에 끼워 넣어도 노션에선 콜아웃 '뒤'에 붙어
    // 화면과 실제가 어긋나기 때문.
    if (!isLocal && !rowObj.nested) {
      item.addEventListener('dragover', e => { if (_bodyDrag && _bodyDrag !== rowObj) { e.preventDefault(); item.classList.add('drag-over'); } });
      item.addEventListener('dragleave', e => { if (!item.contains(e.relatedTarget)) item.classList.remove('drag-over'); });
      item.addEventListener('drop', e => { e.preventDefault(); item.classList.remove('drag-over'); if (_bodyDrag) reorderBodyRow(_bodyDrag, rowObj); });
    }
    // 마크: 기존 블록은 blk.mark, 새로 삽입한 유형(툴박스)은 rowObj.type에서 유도 → 문단 앞 아이콘 즉시 표시
    const _rowMark = (blk && blk.mark) || (rowObj.type === 'to_do' ? (rowObj.checked ? '☑' : '☐') : rowObj.type === 'callout' ? '💡' : rowObj.type === 'quote' ? '❝' : '');
    if (_rowMark) {
      const mk = document.createElement('span'); mk.className = 'body-edit-mark'; mk.contentEditable = 'false'; mk.innerHTML = _markHtml(_rowMark);
      // 인용·콜아웃 마커는 문단 세로 중앙에 (여러 줄짜리 블록이라 첫 줄 정렬이 어중간함)
      if (_rowMark === '💡' || _rowMark === '❝') mk.classList.add('body-edit-mark--mid');
      // 체크박스는 눌러서 켜고 끌 수 있게 — 저장 시 to_do.checked로 노션에 반영
      if (rowObj.type === 'to_do') {
        mk.classList.add('body-edit-check'); mk.setAttribute('role', 'button'); mk.title = '체크 전환';
        const paint = () => { mk.textContent = rowObj.checked ? '☑' : '☐'; mk.classList.toggle('on', rowObj.checked); };
        mk.addEventListener('click', () => { rowObj.checked = !rowObj.checked; paint(); });
        paint();
      }
      item.appendChild(mk);
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
      // 콜아웃은 Enter로 새 블록 분리 금지 — 중간에 문단이 끼면 콜아웃 박스가 깨진다. 대신 소프트 줄바꿈.
      if (e.key === 'Enter' && !e.shiftKey && rowObj.type === 'callout') { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
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
  // 본문이 없거나 비어 있으면 항상 빈 텍스트 박스 하나 — '+ 본문 추가' 대신 바로 타이핑(저장 시 블록 ID 부여)
  if (!rows.length && canAdd) addRow('', isLocal ? { local: true } : null);

  // 편집 액션바(하단 고정): [툴박스] ... [취소] [저장]
  const actions = document.createElement('div'); actions.className = 'detail-edit-actions';
  if (canAdd) {
    // 툴박스: 유형별 줄 삽입(마커를 미리 채운 새 줄 → 저장 시 해당 블록으로 변환)
    const insertTyped = (prefill, newType) => {
      const after = rows.find(r => r.el === document.activeElement) || null;
      const ce = addRow(prefill || '', isLocal ? { local: true } : null, after || undefined, newType);
      ce.focus();
      const rng = document.createRange(); rng.selectNodeContents(ce); rng.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(rng);
    };
    const tbBtn = (label, title, onClick, isHtml) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'detail-tb-btn'; b.title = title;
      if (isHtml) b.innerHTML = label; else b.textContent = label;
      b.addEventListener('mousedown', e => e.preventDefault()); // 편집 포커스 유지
      b.onclick = onClick;
      return b;
    };
    const _bulbSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>';
    // 체크박스: 노션은 문단 앞 클릭형 체크박스(유형 삽입), 로컬(.md)은 desc가 원본이라 마커 텍스트로
    actions.appendChild(tbBtn('☐', '체크박스', () => isLocal ? insertTyped('☐ ') : insertTyped('', { type: 'to_do', checked: false })));
    actions.appendChild(tbBtn('❝', '인용', () => isLocal ? insertTyped('> ') : insertTyped('', { type: 'quote' })));
    actions.appendChild(tbBtn(_bulbSvg, '콜아웃', () => isLocal ? insertTyped('>> ') : insertTyped('', { type: 'callout' }), true));
  }
  const spacer = document.createElement('div'); spacer.className = 'detail-edit-spacer';
  actions.appendChild(spacer);
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'detail-edit-cancel'; cancelBtn.textContent = '취소';
  const saveBtn = document.createElement('button'); saveBtn.className = 'detail-edit-save'; saveBtn.textContent = '저장';
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  contentEl.appendChild(actions);

  if (titleInput) {
    // contenteditable이라 input.select()가 없음 — 예전처럼 전체 선택해서 바로 덮어쓸 수 있게
    titleInput.focus();
    const tr = document.createRange(); tr.selectNodeContents(titleInput);
    const ts = window.getSelection(); ts.removeAllRanges(); ts.addRange(tr);
  }
  else if (rows[0]) rows[0].el.focus();

  const finish = () => renderPaneContent(paneIdx, node);
  cancelBtn.onclick = finish;
  if (titleInput) titleInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
    // 제목은 한 줄 — Enter로 줄바꿈 대신 첫 본문으로 이동(본문이 없으면 그대로)
    if (e.key === 'Enter') { e.preventDefault(); if (rows[0]) _focusEditRow(rows[0], true); }
  });
  saveBtn.onclick = async () => {
    const newTitle = titleValue();
    const titleChanged = !!(titleInput && newTitle && newTitle !== titleMd());
    const valOf = r => markdownFromHtml(r.el);
    const dirty = rows.filter(r => r.isNew ? valOf(r).trim() : valOf(r) !== r.orig);
    const reordered = !isLocal && node.notionBlockId && hasBody && !lockAllRows && (() => {
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
    // 로컬(MD)은 본문이 desc 한 덩어리라 '행을 통째로 지운' 변경이 dirty/deleted에 안 잡힌다
    // (dirty는 남은 행만 보고, deleted는 노션 bodyBlocks 기준) → 재구성한 본문과 원본을 직접 비교
    const normBody = s => String(s || '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
    const localBody = () => normBody(rows.map(valOf).join('\n'));
    const localChanged = isLocal && localBody() !== normBody(node.desc);
    // 체크박스만 껐다 켠 경우 — 텍스트는 그대로라 dirty엔 안 잡힘
    const checksChanged = !isLocal && rows.some(r => r.blk && r.type === 'to_do' && !!r.checked !== !!r.blk.checked);
    if (!titleChanged && !dirty.length && !reordered && !deleted && !localChanged && !checksChanged) { finish(); return; }

    const origBody = (node.bodyBlocks || []).slice();
    const oldBodyIds = origBody.map(b => b.id);
    const finalRows = rows
      .map(r => ({ blk: r.blk, isNew: r.isNew, orig: r.orig, text: valOf(r).trim(), type: r.type || '', checked: !!r.checked, nested: !!r.nested, locked: !!r.locked }))
      .filter(r => r.text.length); // 내용 비운 기존 블록은 삭제로 처리(빈 블록 유지 X)

    // 라벨용 평문 제목 — cleanLabel이 남기는 인라인 코드 백틱까지 떼어, 동기화 때 서버가 주는
    // 평문 title과 같은 모양이 되게(안 그러면 저장 직후에만 `백틱`이 보였다 사라짐)
    const plainTitle = newTitle ? (plainLabel(newTitle) || newTitle) : newTitle;

    saveBtn.disabled = true; cancelBtn.disabled = true; saveBtn.textContent = '저장중…';
    let localWroteFile = false;
    try {
      if (isLocal) {
        if (titleChanged) node.label = plainTitle; // 로컬(.md)은 서식 없는 평문 제목
        node.desc = localBody();
        node.bodyBlocks = []; // 로컬 본문은 desc가 원본 — 남아 있던 블록이 우선 읽혀 삭제가 되돌아 보이던 문제
        saveLocalPages();
        // MD 파일에서 온 노드면 원본 .md에 되쓰기(핸들 있을 때만). 실패해도 세션 저장은 유지
        if (typeof writeBackMdFile === 'function' && String(node.sourcePageId || '').startsWith('md_')) {
          try { localWroteFile = await writeBackMdFile(node.sourcePageId); }
          catch (e) { toast('파일 쓰기 실패(세션엔 저장됨): ' + (e.message || e), { type: 'error', duration: 5000 }); }
        }
      } else {
        const tgt = _appendTarget(node);
        // 제목 변경 먼저 적용
        if (titleChanged) await notionUpdateBlock(node.notionBlockId, newTitle);
        // 독립적인 쓰기는 병렬로 묶어 실제 저장 시간을 줄인다
        let finalBlocks;
        if (reordered) {
          // A안: 자리 바뀐 블록만 옮김(최소 이동) + create-before-delete → 대량 블록도 안 어지럽혀짐
          finalBlocks = await _applyReorder(node, tgt, finalRows, origBody, oldBodyIds);
          node.desc = finalBlocks.map(_bodyDescLine).join('\n'); // 줄머리 표식 복원(안 그러면 재정렬 후 목록·인용 표시가 사라짐)
        } else {
          const pre = [];
          finalRows.filter(r => r.blk && (r.text !== r.orig || _checkFlipped(r)))
            .forEach(r => pre.push(notionUpdateBlock(r.blk.id, r.text, r.type === 'to_do' ? !!r.checked : undefined)));
          // 편집 중 삭제된 기존 본문 블록은 노션에서도 삭제
          const keptIds = new Set(finalRows.filter(r => r.blk).map(r => r.blk.id));
          oldBodyIds.filter(id => !keptIds.has(id)).forEach(id => pre.push(notionDeleteBlock(id).catch(() => {})));
          await Promise.all(pre);
          // 새 본문은 한 번의 호출로 일괄 추가
          const newRows = finalRows.filter(r => !r.blk);
          // 툴박스로 삽입한 유형(체크박스 등)은 r.type로 그 블록 유형 생성, 나머지는 텍스트 마커로 lineToBlock 판정
          const newIds = newRows.length ? await notionAppendBlocks(tgt.parentId, tgt.afterId, newRows.map(r => r.text), 'paragraph', false, newRows.map(r => r.type || null), newRows.map(r => !!r.checked)) : [];
          let qi = 0;
          finalBlocks = finalRows.map(r => _savedBodyBlock(r.blk ? r.blk.id : newIds[qi++], r));
          // desc는 본문 외 내용(표 등) 보존 위해 원본 desc를 블록 단위로 갈아끼운다.
          // 원본 순서(origBody)대로 '위치 커서'를 이동하며 치환 → 같은 텍스트 줄이 여러 개여도
          // 올바른 줄을 갱신(String.replace 첫-일치로 엉뚱한 줄이 바뀌던 중복 버그 방지).
          const rowByBlkId = new Map(finalRows.filter(r => r.blk).map(r => [r.blk.id, r]));
          let d = node.desc || '', from = 0, allMatched = true;
          for (const b of origBody) {
            if (!b.text) continue;
            const om = (b.mark === '☑' || b.mark === '☐') ? b.mark + ' ' : '';
            const needle = om + b.text;
            const at = d.indexOf(needle, from);
            if (at < 0) { allMatched = false; continue; }
            const r = rowByBlkId.get(b.id);
            if (!r) { d = d.slice(0, at) + d.slice(at + needle.length); continue; } // 삭제된 블록 제거(커서 유지)
            const nm = r.type === 'to_do' ? (r.checked ? '☑ ' : '☐ ') : om;
            if (r.text !== b.text || nm !== om) { const repl = nm + r.text; d = d.slice(0, at) + repl + d.slice(at + needle.length); from = at + repl.length; }
            else from = at + needle.length;
          }
          finalRows.filter(r => !r.blk).forEach(r => { const line = _bodyDescLine(r); d = d ? d + '\n' + line : line; }); // 새 블록은 끝에(유형 마커 포함)
          node.desc = allMatched ? d.replace(/\n{3,}/g, '\n\n').trim() : finalBlocks.map(_bodyDescLine).join('\n');
        }
        node.bodyBlocks = finalBlocks.filter(b => b.id);
        invalidateNodeCache(node);
      }
      if (titleChanged) {
        // 라벨은 항상 평문(검색·노드 매칭·그래프 표시가 이걸 씀), 서식 원문은 labelMd에
        node.label = plainTitle;
        if (!isLocal) node.labelMd = newTitle;
        refreshOpenPanes();
        if (isLocal && node.level === 0 && window._sidebarPageList) {
          const it = window._sidebarPageList.find(p => p.id === node.sourcePageId);
          if (it) { it.title = node.label; refreshSidebarRender(); }
        }
      }
      if (typeof resolveWikiLinks === 'function') resolveWikiLinks(); // 본문 변경 → 위키링크 재해석
      isStable = false;
      finish();
      toast(isLocal ? (localWroteFile ? '파일에 저장됨' : '저장됨') : '노션에 저장됨', { type: 'success' });
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

// 편집 행의 체크 상태가 노션의 기존 값과 달라졌는가 (to_do만 해당)
function _checkFlipped(r) { return r.type === 'to_do' && r.blk && !!r.checked !== !!r.blk.checked; }

// 저장 결과를 bodyBlocks 항목으로 — 유형·마커·체크 상태까지 들고 있어야
// 다음 재정렬에서 목록/인용/콜아웃이 문단으로 납작해지지 않는다
// 새로 입력한 줄은 타이핑한 줄머리 마커('- ', '[x] ' …)가 아직 텍스트에 붙어 있다(서버가 그걸 보고 유형을 정함).
// 저장 결과에는 유형·체크로 옮기고 텍스트에선 떼야 함 — 안 그러면 다음 재정렬에서 '- - 항목'처럼 겹친다.
function _savedBodyBlock(id, r) {
  const isNew = !r.blk;
  // r.type가 있으면(툴박스 삽입·기존 블록) 그대로, 없으면(수기 마크다운 새 줄) 텍스트 마커로 판정
  const type = r.type || (r.blk && r.blk.type) || _blockTypeOf(r.text);
  const text = isNew ? bodyBlockText(r.text) : r.text;
  const checked = type === 'to_do' ? (!!r.checked || _blockChecked(r.text)) : false;
  const mark = type === 'to_do' ? (checked ? '☑' : '☐') : ((r.blk && r.blk.mark) || _listMark(r.text));
  // nested를 잃으면 다음 편집에서 콜아웃 자식이 이동 가능해져 구조가 깨진다
  return { id, text, type, checked, mark, ...(r.nested || (r.blk && r.blk.nested) ? { nested: true } : {}) };
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
// 옮겨지는 블록은 types/checks로 원래 유형을 그대로 재생성 — 문단으로 납작해지지 않게
// 반환: 새 순서의 [{ id, text, type, checked, mark }] (bodyBlocks 용)
async function _applyReorder(node, tgt, finalRows, origBody, oldBodyIds) {
  // 기존 블록만 유형을 지정해 그대로 재생성. 새로 입력한 줄은 마커가 텍스트에 남아 있으므로
  // null로 넘겨 서버의 lineToBlock이 마커를 떼면서 유형을 정하게 둔다(마커 중복 방지)
  const typesOf = rs => rs.map(r => r.type || (r.blk ? _blockTypeOf(r.text) : null));
  const checksOf = rs => rs.map(r => !!r.checked);
  const oldIndex = {}; origBody.forEach((b, i) => { oldIndex[b.id] = i; });
  // 유지되는(기존) 행을 새 순서로 나열 → 옛 인덱스 수열
  const keptSeq = [];
  finalRows.forEach((r, pos) => { if (r.blk && oldIndex[r.blk.id] != null) keptSeq.push({ pos, oldIdx: oldIndex[r.blk.id] }); });
  const lis = _lisIndices(keptSeq.map(k => k.oldIdx));
  const stayPos = new Set(lis.map(i => keptSeq[i].pos)); // 제자리 유지할 finalRows 위치(ID 보존)
  // 이동 금지 줄(중첩 블록·콜아웃 본체)은 LIS가 '이동'으로 골랐더라도 강제로 제자리 유지.
  // 재생성하면 콜아웃 밖으로 튀어나가거나(자식) 자식이 통째로 사라진다(본체).
  finalRows.forEach((r, pos) => { if (r.blk && r.locked) stayPos.add(pos); });

  // 삽입 런 구성: 유지 블록(안정 앵커) 사이에 낀 이동/신규 블록 묶음 (모두 안정 앵커라 병렬 삽입 가능)
  const START = tgt.afterId || null; // 본문 첫 위치 앵커(일반 헤딩=헤딩ID / 토글·페이지=null)
  const runs = []; let cur = null, anchor = START;
  for (let pos = 0; pos < finalRows.length; pos++) {
    // 중첩 블록 id는 콜아웃 '안'이라 최상위 삽입 앵커로 쓸 수 없다(노션이 거부) → 앵커 갱신은 건너뛴다.
    // 콜아웃 본체가 직전 앵커로 남으므로, 그 뒤에 넣으면 화면상 콜아웃 다음 자리와 일치한다.
    if (stayPos.has(pos)) { if (cur) { runs.push(cur); cur = null; } if (!finalRows[pos].nested) anchor = finalRows[pos].blk.id; }
    else { if (!cur) cur = { anchorId: anchor, rows: [] }; cur.rows.push({ pos, r: finalRows[pos] }); }
  }
  if (cur) runs.push(cur);

  // 맨 앞 삽입인데 앵커가 없으면(토글/페이지 직속) 정밀 이동 불가 → 안전 폴백(전부 새로 만든 뒤 옛것 삭제)
  if (runs.length && runs[0].anchorId == null) {
    const ids = finalRows.length ? await notionAppendBlocks(tgt.parentId, tgt.afterId, finalRows.map(r => r.text), 'paragraph', false, typesOf(finalRows), checksOf(finalRows)) : [];
    await Promise.all(oldBodyIds.map(id => notionDeleteBlock(id).catch(() => {})));
    return finalRows.map((r, i) => _savedBodyBlock(ids[i] || (r.blk && r.blk.id), r));
  }

  // 1) 제자리 유지 블록의 텍스트 변경은 병렬 갱신(블록 내용 PATCH — 부모 children과 별개)
  const stayUpdates = [];
  finalRows.forEach((r, pos) => {
    if (stayPos.has(pos) && (r.text !== r.orig || _checkFlipped(r))) stayUpdates.push(notionUpdateBlock(r.blk.id, r.text, r.type === 'to_do' ? !!r.checked : undefined));
  });
  const updatesP = Promise.all(stayUpdates);
  // 런은 같은 부모 children 동시 쓰기 충돌을 피하려 순차 삽입(보통 1~2개)
  const newIdByPos = {};
  for (const run of runs) {
    const rs = run.rows.map(x => x.r);
    const ids = await notionAppendBlocks(tgt.parentId, run.anchorId, rs.map(r => r.text), 'paragraph', true, typesOf(rs), checksOf(rs));
    run.rows.forEach((x, k) => { newIdByPos[x.pos] = ids[k]; });
  }
  await updatesP;

  // 2) append 성공 후에만 옛 블록 삭제(제자리 유지 제외 = 이동된 옛 복사본 + 제거된 블록)
  const stayedIds = new Set([...stayPos].map(pos => finalRows[pos].blk.id));
  await Promise.all(oldBodyIds.filter(id => !stayedIds.has(id)).map(id => notionDeleteBlock(id).catch(() => {})));

  // 3) 새 순서 + 라이브 ID로 bodyBlocks 구성
  return finalRows.map((r, pos) => _savedBodyBlock(stayPos.has(pos) ? r.blk.id : newIdByPos[pos], r));
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
  const pageRoot = nodes.find(nd => nd.level === 0 && String(nd.sourcePageId || '').replace(/-/g, '') === norm);
  _activeGlowIds = new Set(pageRoot ? [pageRoot.id] : []); // 이전 모드의 글로우가 남지 않게 여기서 갱신
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
  // 최근 본 노드 추적 (노드 섹션용)
  if (n && n.id && typeof _recentNodes !== 'undefined') {
    _recentNodes = _recentNodes.filter(id => id !== n.id);
    _recentNodes.unshift(n.id);
    if (_recentNodes.length > 10) _recentNodes.length = 10;
    if (typeof bumpNodeView === 'function') bumpNodeView(n); // '자주 본 노드' 집계
    if (_activeRailSection === 'bookmarks' && typeof renderBookmarkList === 'function') renderBookmarkList();
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

