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
  const tocIc = `<div class="lg-toc-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg></div>`;
  const tab = (id, label) => `<button class="lg-tab" data-tab="${id}" onclick="_setLegendTab('${id}')">${label}</button>`;
  const tabs = `<div class="lg-tabs">${tocIc}${tab('symbols', '기호')}${tab('tools', '도구')}${tab('ai', 'AI')}</div>`;
  const content = `<div class="lg-tab-body" id="lg-scroll" onscroll="_updateLegendActiveTab()">`
    + `<div class="lg-divider" id="lg-sec-symbols">그래프 기호</div>`
    + _legendSymbolsHtml()
    + `<div class="lg-divider lg-divider-gap" id="lg-sec-tools">노드 툴바</div>`
    + _legendToolsHtml()
    + `<div class="lg-divider lg-divider-gap" id="lg-sec-ai">AI</div>`
    + _legendAiHtml()
    + `</div>`;
  body.innerHTML = content + tabs;
  _updateLegendActiveTab();
}
const _LEGEND_SECS = ['symbols', 'tools', 'ai'];
function _setLegendTab(t) {
  const scroll = document.getElementById('lg-scroll');
  const target = document.getElementById('lg-sec-' + t);
  if (scroll && target) scroll.scrollTo({ top: Math.max(0, target.offsetTop - scroll.offsetTop - 6), behavior: 'smooth' });
}
function _updateLegendActiveTab() {
  const scroll = document.getElementById('lg-scroll'); if (!scroll) return;
  const st = scroll.scrollTop + 40;
  let active = 'symbols';
  _LEGEND_SECS.forEach(id => { const el = document.getElementById('lg-sec-' + id); if (el && (el.offsetTop - scroll.offsetTop) <= st) active = id; });
  document.querySelectorAll('#legend .lg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === active));
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
  const S = {
    ringDash: `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="2.2 2.2"/></svg>`,
  };
  const L = {
    solid: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="31" y2="5" stroke="#9fb0c6" stroke-width="2"/></svg>`,
    wiki: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="24" y2="5" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 3"/><path d="M23 2 L30 5 L23 8" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  };
  const glow = (c) => `<span class="lg-glow" style="background:radial-gradient(circle, ${c} 0%, transparent 70%)"></span>`;
  const colorSec = `<div class="lg-row lg-tool"><span><b>노드별</b>: 노드마다 색상 변화</span></div>`
    + `<div class="lg-row lg-tool"><span><b>깊이별</b>: 헤딩 레벨에 따라 색상 변화</span></div>`;
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
  const row = (name, desc) => `<div class="lg-row lg-tool"><span><b>${name}</b>: ${desc}</span></div>`;
  return `<div class="lg-note lg-note-top">노드 우클릭 시 도구 툴바 표시</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">편집</div>`
    + row('하위 노드 추가', '자식 노드 생성')
    + row('노드 동기화', 'Notion 최신화')
    + row('노션에서 보기', '노션 페이지로 이동')
    + row('북마크', '즐겨찾기')
    + row('노드 삭제', '삭제')
    + `</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">탐색</div>`
    + row('노드 연결', '노드 간 연결')
    + row('포커스 모드', '연결된 노드 포커스')
    + row('경로 찾기', '최단 경로 표시')
    + row('위성 모드', '그래프 분리')
    + row('노드 고정', '노드 고정 및 위치 이동')
    + `</div>`;
}
function _legendAiHtml() {
  const row = (name, desc) => `<div class="lg-row lg-tool"><span><b>${name}</b>: ${desc}</span></div>`;
  return `<div class="lg-note lg-note-top">제미나이 API 필요</div>`
    + `<div class="lg-sec"><div class="lg-sec-title">AI가 해주는 것</div>`
    + row('노드 요약', '선택 노드(하위&연결 포함)')
    + row('연결 추천', '관련 노드를 찾아 연결 제안')
    + row('본문 다듬기', '선택 노드 문법&문장 교정')
    + row('링크 가져오기', '웹&유튜브를 시각화')
    + `</div>`;
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
    const pe = getParentEdge(cur); // 위키링크는 weakLink라 이미 제외됨
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
// 링크 표시 텍스트에 [ ] 가 남아 있으면 [텍스트](url) 파서가 깨진다(제목이 "[기존 Tool과 차이]" 같은 경우
// [[기존 Tool과 차이]](url) 이 되어 _LINK_RE가 아예 매칭 실패 → 엣지 안 생김).
// 대상 식별은 URL이 하므로 표시 텍스트에서 대괄호를 빼도 해석에는 지장 없음
function _linkSafeText(s) {
  return String(s || '').replace(/[\[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim() || '링크';
}
function _wikiLinkText(b) { return `[${_linkSafeText(b.label)}](${_wikiUrlFor(b)})`; }
// 로컬(옵시디언) 링크 문법: 파일=[[노트]], 헤딩=[[노트#헤딩]]
// [ ] | # 은 [[ ]] 안에 못 들어간다(옵시디언도 동일). 노션 내보내기 파일명처럼 라벨에 이런 문자가
// 섞이면 [[[작업] 3633…#제목]] 같은 깨진 참조가 되어 링크가 해석되지 않으므로, 그럴 땐 내부 링크
// [텍스트](snlog:node:<페이지>:<라벨>) 형태로 쓴다 — 라벨이 URL 인코딩돼 어떤 문자든 안전
const _WIKI_UNSAFE = /[\[\]|#\n]/;
function _wikiLinkTextLocal(b) {
  const root = b.level === 0 ? b
    : ((typeof nodes !== 'undefined') ? nodes.find(n => n.sourcePageId === b.sourcePageId && n.level === 0) : null);
  const note = root ? (root.label || '') : (b.label || '');
  const head = (root && root.id !== b.id) ? (b.label || '') : '';
  if (!_WIKI_UNSAFE.test(note) && !_WIKI_UNSAFE.test(head)) {
    return head ? `[[${note}#${head}]]` : `[[${note}]]`;
  }
  return `[${_linkSafeText(b.label)}](${_wikiUrlFor(b)})`;
}
function _linkResolvesTo(url, b) { const t = _nodeFromLinkUrl(url); return !!(t && t.id === b.id); }
function _hasWikiLinkTo(a, b) {
  // 본문 블록과 desc 둘 다 훑는다 — 한쪽에만 링크가 있어도 이미 연결로 판정되게(토글이 어긋나던 문제)
  const text = [(a.bodyBlocks && a.bodyBlocks.length) ? a.bodyBlocks.map(x => x.text).join('\n') : '', a.desc || ''].join('\n');
  const re = /\[([^\]]*)\]\(([^)\s]+)\)/g; let m;
  while ((m = re.exec(text))) { if (_linkResolvesTo(m[2], b)) return true; }
  // 로컬은 [[ ]] 형식도 검사
  if (typeof _isLocalSource === 'function' && _isLocalSource(a) && typeof _nodeFromWikiRef === 'function') {
    const rw = /\[\[([^\]\n]+?)\]\]/g; let w;
    while ((w = rw.exec(text))) { const t = _nodeFromWikiRef(w[1], a); if (t && t.id === b.id) return true; }
  }
  return false;
}
function _wikiReflect() { if (typeof resolveWikiLinks === 'function') resolveWikiLinks(); isStable = false; refreshOpenPanes(); }
// A→B 위키 연결: 그래프 즉시 반영 + 노션 저장은 백그라운드(실패 시 롤백)
function _wikiConnect(a, b) {
  // 로컬 노드는 옵시디언식 [[ ]]로, 노션 노드는 [텍스트](url)로
  // 표기 판정과 저장 경로 판정이 어긋나면(.local만 보면) MD 노드가 노션 append로 새서 실패·롤백되므로 같은 값을 쓴다
  const localA = (typeof _isLocalSource === 'function') ? _isLocalSource(a) : !!a.local;
  const text = localA ? _wikiLinkTextLocal(b) : _wikiLinkText(b);
  if (localA) {
    a.desc = (a.desc && a.desc.trim()) ? (a.desc + '\n' + text) : text;
    // 본문이 블록으로 쪼개져 있으면 그쪽이 우선 읽히므로(resolveWikiLinks) 같이 넣어줘야 엣지가 생김
    if (a.bodyBlocks && a.bodyBlocks.length) {
      a.bodyBlocks = a.bodyBlocks.concat([{ id: '_loc_' + Date.now() + Math.random().toString(36).slice(2), text }]);
    }
    _wikiReflect(); saveLocalPages();
    // 링크를 원본 .md에도 반영(핸들 있을 때). 비차단
    if (typeof writeBackMdFile === 'function' && String(a.sourcePageId || '').startsWith('md_')) {
      writeBackMdFile(a.sourcePageId).catch(() => {});
    }
    return;
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
  const localA = (typeof _isLocalSource === 'function') ? _isLocalSource(a) : !!a.local;
  const stripMd = line => line.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (mm, txt, url) => _linkResolvesTo(url, b) ? '' : mm);
  // 로컬은 [[ ]]로 저장되므로 그 형태도 지워야 함 — 안 지우면 resolveWikiLinks가 곧바로 다시 이어 붙여 해제가 안 되는 것처럼 보임
  const stripWiki = line => line.replace(/\[\[([^\]\n]+?)\]\]/g, (mm, ref) => {
    const t = (typeof _nodeFromWikiRef === 'function') ? _nodeFromWikiRef(ref, a) : null;
    return (t && t.id === b.id) ? '' : mm;
  });
  const stripLine = line => localA ? stripWiki(stripMd(line)) : stripMd(line);
  const stripDesc = () => {
    const out = [];
    (a.desc || '').split('\n').forEach(line => { const st = stripLine(line); if (st.trim() === '' && st !== line) return; out.push(st); });
    a.desc = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  if (localA) {
    if (a.bodyBlocks && a.bodyBlocks.length) {
      a.bodyBlocks = a.bodyBlocks.map(x => ({ ...x, text: stripLine(x.text || '') })).filter(x => (x.text || '').trim() !== '');
    }
    stripDesc(); _wikiReflect(); saveLocalPages();
    if (typeof writeBackMdFile === 'function' && String(a.sourcePageId || '').startsWith('md_')) {
      writeBackMdFile(a.sourcePageId).catch(() => {});
    }
    return;
  }
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
// 연결 클릭을 받을 수 있는 노드 — 페이지/MD 파일 루트(level 0)도 대상.
// 페이지에 속하지 않은 합성 최상위 루트만 제외(연결할 본문 자체가 없음)
function canConnectNode(n) { return !!n && (n.level > 0 || !!n.sourcePageId); }
// ── 연결 저장 방식은 출처별로 완전히 분리 ────────────────────────────
// 로컬(MD)끼리  → 본문에 [[ ]]/내부링크 기록 + 원본 .md 되쓰기
// 노션끼리      → 노션 블록에 [텍스트](노션URL) 추가
// 서로 다른 출처 → 어느 쪽 본문에도 상대를 가리킬 링크를 못 쓴다(노션은 snlog: URL을 거부하고,
//                 MD 노드는 노션 블록이 없음). 그래서 그래프에만 남는 수동 연결로 저장한다.
function _manualEdgeBetween(a, b) {
  if (!a || !b) return null;
  return edges.find(e => e.manualLink && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) || null;
}
// 두 노드가 어떤 방식으로든 이어져 있는지 (위키 링크 / 수동 연결)
function isPairConnected(a, b) {
  if (!a || !b) return false;
  return _hasWikiLinkTo(a, b) || !!_manualEdgeBetween(a, b);
}
function _toggleManualLink(a, b) {
  const e = _manualEdgeBetween(a, b);
  if (e) edges = edges.filter(x => x !== e);
  else edges.push({ from: a.id, to: b.id, manualLink: true });
  saveManualLinks();
  isStable = false; refreshOpenPanes();
  return !!e;
}
function toggleWikiConnect(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const la = _isLocalSource(a), lb = _isLocalSource(b);
  if (la !== lb) return _toggleManualLink(a, b); // MD ↔ 노션은 본문에 기록할 수단이 없음
  const existed = _hasWikiLinkTo(a, b);
  if (existed) _wikiDisconnect(a, b); else _wikiConnect(a, b);
  return existed;
}
function handleConnectClick(n) {
  const s = document.getElementById('status');
  if (!_connectFirstNode) {
    _connectFirstNode = n; n.connectSelected = true;
    if (s) s.textContent = `"${n.label}" 선택됨 — 연결할 노드 클릭`;
    isStable = false; return;
  }
  if (_connectFirstNode.id === n.id) {
    _connectFirstNode.connectSelected = false; _connectFirstNode = null;
    if (s) s.textContent = '연결 모드: 첫 번째 노드 클릭';
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
  if (canAddChild(node)) html += `<button onclick="multiSelectAddChild()" title="해당 노드에 하위 노드 추가">${branchIcon} 하위 노드 추가</button>`;
  if (!node.local && node.notionBlockId) html += `<button onclick="multiSelectSyncNode()" title="노션 동기화">${syncIcon} 노드 동기화</button>`;
  if (!isLocalLike && (node.notionBlockId || node.sourcePageId)) html += `<button onclick="multiSelectOpenNotion()" title="노션 페이지 해당 위치로 이동.">${notionIcon} 노션에서 보기</button>`;
  html += `<button onclick="multiSelectBookmark()" title="즐겨찾기">${bmIcon} 북마크${bmOn ? ' 해제' : ''}</button>`;
  if (canDeleteNode(node)) html += `<button class="ms-danger" onclick="multiSelectDelete()" title="노드 삭제">${trashIcon} 노드 삭제</button>`;
  return html;
}

// 편집 툴 (다중 선택): 북마크 / 노드 삭제
function _multiEditToolsHtml() {
  const nodes = _multiSelected || [];
  if (!nodes.length) return '';
  const trashIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  const allBm = nodes.every(isBookmarked);
  const bmIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>${allBm ? '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>' : ''}</svg>`;
  let html = `<button onclick="multiSelectBookmark()" title="즐겨찾기">${bmIcon} 북마크${allBm ? ' 해제' : ''}</button>`;
  if (nodes.some(canDeleteNode)) html += `<button class="ms-danger" onclick="multiSelectDelete()" title="노드 삭제">${trashIcon} 노드 삭제</button>`;
  return html;
}

// 탐색 툴: 연결 / 포커스 / 경로 / 위성 (선택 개수에 따라 달라짐)
function _exploreToolsHtml() {
  const n = _multiSelected.length;
  const chainIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const focusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2"/></svg>`;
  let html = '';
  if (n === 1) {
    html += `<button onclick="multiSelectStartConnect()" title="해당 노드를 다른 노드들과 연결/해제">${chainIcon} 노드 다중 연결</button>`;
    html += `<button onclick="multiSelectFocus()" title="해당 노드의 상/하위 노드만 표시">${focusIcon} 포커스 모드</button>`;
  } else if (n === 2) {
    html += `<button onclick="multiSelectConnect()" title="선택한 두 노드를 연결/해제">${chainIcon} 노드 간 연결</button>`;
  } else {
    html += `<button onclick="multiSelectChainConnect()" title="선택한 순서대로 연결/해제">${chainIcon} 순서대로 연결</button>`;
  }
  html += `<button onclick="multiSelectPath()" title="${n === 1 ? '최상위 노드까지의 경로를 표시' : '선택한 노드들 사이의 최단 경로만 표시'}">↔ 경로 찾기</button>`;
  const satOn = _multiSelected.every(nd => nd._satelliteRoot);
  const satIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/></svg>`;
  html += `<button onclick="multiSelectSatellite()" title="선택한 노드와 하위 노드를 상위에서 분리/복원">${satIcon} 위성 모드${satOn ? ' 해제' : ''}</button>`;
  const pinOn = _multiSelected.length > 0 && _multiSelected.every(nd => nd.fixed);
  const pinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${pinOn ? 'rgba(237,112,0,0.25)' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
  html += `<button onclick="multiSelectPin()" title="선택한 노드를 제자리에 고정/해제">${pinIcon} ${pinOn ? '고정 해제' : '노드 고정'}</button>`;
  return html;
}

