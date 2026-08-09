// ── 범례(그래프 기호 설명) 오버레이 ───────────────────────────────────
let _legendOpen = (() => { try { return localStorage.getItem('snlog_legend_open') === '1'; } catch (e) { return false; } })();
function toggleLegend() {
  _legendOpen = !_legendOpen;
  try { localStorage.setItem('snlog_legend_open', _legendOpen ? '1' : '0'); } catch (e) {}
  applyLegendState();
}
// 범례는 다른 레일 섹션과 달리 '켜짐/꺼짐'이 독립이다 —
// 섹션이 열려 있으면 그 아래에 이어 붙고, 없으면 혼자 사이드바를 연다.
function applyLegendState() {
  const pane = document.getElementById('legend-panel');
  if (pane) pane.classList.toggle('active', _legendOpen);
  const btn = document.getElementById('rail-legend');
  if (btn) btn.classList.toggle('active', _legendOpen);
  if (_legendOpen) renderLegendBody();
  // 사이드바는 '섹션이 열렸거나 범례가 켜졌을 때' 열려 있어야 한다
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.toggle('open', _legendOpen || !!_activeRailSection);
  // 좁은 화면에선 상세 패널과 동시에 못 편다 (레일 섹션과 같은 규칙)
  if (_legendOpen && typeof _panelsExclusive === 'function' && _panelsExclusive()
      && typeof collapseDetailPanel === 'function') collapseDetailPanel();
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
  const S = 40, cx = 20, cy = 20, D = 18; // D=표시 크기(.lg-shape 폭과 같아야 줄 정렬이 안 흔들린다)
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  // 최상위(8각별)는 뾰족한 가지가 가늘어 같은 크기로 그리면 유독 흐리게 보인다 → 상자를 꽉 채워 그린다
  if (kind === 'circle') { g.fillStyle = '#c9d3e2'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill(); }
  else if (kind === 'star8' && typeof drawStar8 === 'function') { g.fillStyle = '#ffffff'; drawStar8(g, cx, cy, 10); g.fill(); }
  else if (kind === 'star4' && typeof drawStar4 === 'function') { g.fillStyle = '#eef2f8'; drawStar4(g, cx, cy, 13); g.fill(); }
  else if (kind === 'starX' && typeof drawStarX === 'function') { g.fillStyle = '#eef2f8'; drawStarX(g, cx, cy, 15); g.fill(); }
  return `<img class="lg-shape-img" src="${c.toDataURL()}" width="${D}" height="${D}" alt="">`;
}
// 노드 배지를 그래프와 같은 함수로 그려 범례에 넣는다 — 색·글리프는 graph.js draw()와 짝을 맞춘다
function _legendBadgeImg(kind) {
  const S = 40, cx = 20, cy = 20, R = 13;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const acc = cssRgb('--accent-rgb', [237,112,0]);
  const spec = {
    panel:     { rgb: [39,174,96],   glyph: 'pencil' },
    select:    { rgb: acc, ink: BADGE_INK_DARK, glyph: '1' },
    fixed:     { rgb: [255,255,255], glyph: 'pin' },
    bookmark:  { rgb: [0,0,0], ink: acc, glyph: 'bookmark' },
    satellite: { rgb: [0,0,0], ink: cssRgb('--satellite-rgb', [90,200,250]), glyph: 'orbit' },
  }[kind];
  // 배지 반지름 대비 글리프 비율을 그래프와 맞춘다(7/R)
  _drawBadge(g, cx, cy, 7 / R, spec);
  return `<img class="lg-shape-img" src="${c.toDataURL()}" width="18" height="18" alt="">`;
}

function _legendSymbolsHtml() {
  const L = {
    solid: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="31" y2="5" stroke="#9fb0c6" stroke-width="2"/></svg>`,
    wiki: `<svg width="32" height="10" viewBox="0 0 32 10"><line x1="1" y1="5" x2="24" y2="5" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 3"/><path d="M23 2 L30 5 L23 8" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  };
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
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('select')}</span><span>선택한 노드 (선택 순번)</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('panel')}</span><span>상세 내용 열림</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('fixed')}</span><span>노드 고정</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('bookmark')}</span><span>북마크</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('satellite')}</span><span>위성 모드</span></div>`
    + `</div>`;
}
// 하위 노드 추가 — 우클릭 툴바와 우측 패널 메뉴가 같이 쓴다(둘 다 바꿔야 해서 한 곳에 둔다)
// viewBox는 그림 경계에 맞춰 잘라낸 값 — 원본 1024 상자엔 여백이 커서 옆 아이콘보다 작아 보였다
const ADD_CHILD_PATH = 'M 493.50 842.38 C485.14,841.11 468.51,836.34 460.72,832.99 C445.91,826.60 435.74,819.61 422.94,807.00 C410.08,794.34 403.01,784.60 396.41,770.46 C387.64,751.70 384.45,734.87 385.23,711.52 L 385.74 696.35 L 369.12 686.31 C359.98,680.78 344.17,671.18 334.00,664.98 C323.83,658.77 313.48,652.48 311.00,651.00 C307.15,648.69 290.80,638.76 257.82,618.68 C253.60,616.10 249.82,614.00 249.43,614.00 C249.04,614.00 245.96,615.74 242.59,617.87 C229.40,626.20 217.49,631.24 202.00,635.06 C193.74,637.09 190.08,637.40 174.00,637.37 C156.61,637.35 154.81,637.17 144.00,634.31 C112.88,626.07 86.91,607.75 69.72,581.88 C49.28,551.14 43.41,511.60 54.00,476.00 C59.91,456.11 70.31,439.39 86.94,423.00 C104.37,405.83 120.78,396.53 144.50,390.38 C154.73,387.72 156.83,387.52 174.50,387.53 C191.18,387.53 194.60,387.82 202.50,389.87 C221.45,394.80 236.62,402.05 251.32,413.21 L 259.15 419.15 L 288.82 400.49 C373.22,347.41 386.22,339.18 387.15,338.25 C387.83,337.57 387.60,333.69 386.45,326.37 C384.02,310.92 384.85,289.19 388.39,275.85 C394.80,251.63 404.90,233.91 421.93,216.98 C435.63,203.36 452.16,192.98 469.94,186.84 C480.33,183.25 499.54,180.00 510.33,180.00 C541.90,180.01 574.69,193.44 597.53,215.72 C615.75,233.50 626.25,252.04 632.79,278.00 C635.15,287.37 635.44,290.39 635.44,306.00 C635.44,321.77 635.16,324.58 632.68,334.48 C626.58,358.81 616.31,376.90 598.59,394.54 C579.15,413.88 558.15,425.01 532.49,429.54 C499.75,435.32 465.19,427.61 437.78,408.41 C433.54,405.43 429.86,403.00 429.61,403.00 C429.36,403.00 415.51,411.61 398.83,422.13 C382.15,432.65 352.39,451.40 332.70,463.79 C304.98,481.24 297.05,486.68 297.52,487.91 C300.71,496.20 300.38,524.71 296.93,539.50 C295.78,544.45 294.76,549.04 294.67,549.69 C294.52,550.76 311.62,561.39 392.50,610.47 C406.25,618.81 418.47,626.26 419.66,627.00 C421.65,628.26 422.25,627.97 427.40,623.27 C441.45,610.42 460.58,600.59 481.97,595.21 C491.43,592.83 494.33,592.56 510.50,592.57 C526.01,592.58 529.81,592.91 538.00,594.93 C562.52,601.00 581.83,611.77 599.03,628.97 C616.55,646.49 627.75,666.95 633.26,691.49 C636.52,706.03 636.44,730.29 633.08,744.50 C621.79,792.33 588.06,826.86 540.15,839.63 C531.95,841.82 527.94,842.25 513.50,842.52 C504.15,842.69 495.15,842.63 493.50,842.38 ZM 805.29 837.61 C795.71,834.48 787.35,827.52 783.04,819.08 C778.31,809.81 778.00,806.21 778.00,761.29 L 778.00 719.00 L 734.47 719.00 C693.11,719.00 690.63,718.90 684.80,716.93 C673.82,713.23 665.58,705.86 660.77,695.42 C658.89,691.34 658.50,688.78 658.50,680.50 C658.50,671.74 658.83,669.79 661.18,664.78 C664.92,656.80 671.94,649.65 679.87,645.74 L 686.45 642.50 L 732.23 642.20 L 778.00 641.91 L 778.00 600.00 C778.00,547.57 778.58,544.33 789.96,532.96 C796.24,526.67 801.82,523.73 810.82,521.96 C826.53,518.86 843.99,528.10 851.56,543.51 L 854.50 549.50 L 854.79 595.70 L 855.08 641.91 L 901.29 642.20 L 947.50 642.50 L 954.74 646.37 C963.41,651.00 968.14,655.97 972.36,664.88 C975.16,670.79 975.50,672.46 975.48,680.50 C975.46,688.48 975.10,690.26 972.32,696.18 C968.32,704.70 961.72,711.31 953.18,715.34 L 946.50 718.50 L 900.79 718.80 L 855.08 719.09 L 854.79 765.30 L 854.50 811.50 L 851.50 817.44 C847.67,825.03 840.68,832.03 833.36,835.61 C828.57,837.96 826.10,838.47 818.56,838.70 C812.86,838.88 807.94,838.47 805.29,837.61 Z';
const addChildIcon = (px) => `<svg width="${px}" height="${px}" viewBox="43 45 932 932" fill="currentColor"><path d="${ADD_CHILD_PATH}"/></svg>`;
// 페이지 목록의 동기화 버튼과 같은 아이콘 — 화살표 1개(페이지) / 2개(전체)
const SYNC_ONE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const SYNC_ALL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
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
    + row('위성 모드', '그래프 분리')
    + row('노드 고정', '노드 고정 및 위치 이동')
    + `</div>`
    // 동기화 두 가지가 같은 자리에 있어 헷갈리기 쉬움 — 무엇이 다른지 여기서 설명
    + `<div class="lg-sec"><div class="lg-sec-title">동기화</div>`
    + `<div class="lg-row lg-tool"><span class="lg-shape">${SYNC_ONE}</span><span><b>페이지 동기화</b>: 그 페이지만. 바뀐 하위 페이지·DB 항목만 다시 받음</span></div>`
    + `<div class="lg-row lg-tool"><span class="lg-shape" style="color:var(--accent);">${SYNC_ALL}</span><span><b>전체 동기화</b>: 담은 페이지 전부 + MD·폴더. <b>새로 만든 노션 페이지</b>도 목록에 반영</span></div>`
    + `<div class="lg-note">헤딩과 본문은 두 경우 모두 항상 다시 받음</div>`
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
  const trashIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  const syncIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  const bmOn = isBookmarked(node);
  const bmIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>${bmOn ? '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>' : ''}</svg>`;
  const notionIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const isLocalLike = node.local || String(node.sourcePageId || '').startsWith('md_') || String(node.sourcePageId || '').startsWith('local_');
  let html = '';
  if (canAddChild(node)) html += `<button onclick="multiSelectAddChild()" title="해당 노드에 하위 노드 추가">${addChildIcon(12)} 하위 노드 추가</button>`;
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
  const focusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3v3c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V3z"/><path d="M6 6h12"/></svg>`;
  let html = '';
  if (n === 1) {
    html += `<button onclick="multiSelectStartConnect()" title="해당 노드를 다른 노드들과 연결/해제">${chainIcon} 노드 다중 연결</button>`;
    // 고정·위성 버튼과 같은 방식 — 켜져 있으면 해제 버튼으로 보인다
    const focusOn = _focusMode && _focusNodeId === _multiSelected[0].id;
    html += `<button onclick="multiSelectFocus()" title="${focusOn ? '포커스 모드 해제' : '해당 노드의 상/하위 노드만 표시'}">${focusIcon} ${focusOn ? '포커스 해제' : '포커스 모드'}</button>`;
  } else if (n === 2) {
    html += `<button onclick="multiSelectConnect()" title="선택한 두 노드를 연결/해제">${chainIcon} 노드 간 연결</button>`;
  } else {
    html += `<button onclick="multiSelectChainConnect()" title="선택한 순서대로 연결/해제">${chainIcon} 순서대로 연결</button>`;
  }
  const satOn = _multiSelected.every(nd => nd._satelliteRoot);
  const satIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="18.4" cy="5.6" r="2.8" fill="currentColor" stroke="none"/></svg>`;
  html += `<button onclick="multiSelectSatellite()" title="선택한 노드와 하위 노드를 상위에서 분리/복원">${satIcon} 위성 모드${satOn ? ' 해제' : ''}</button>`;
  const pinOn = _multiSelected.length > 0 && _multiSelected.every(nd => nd.fixed);
  const pinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${pinOn ? 'rgba(237,112,0,0.25)' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
  html += `<button onclick="multiSelectPin()" title="선택한 노드를 제자리에 고정/해제">${pinIcon} ${pinOn ? '고정 해제' : '노드 고정'}</button>`;
  return html;
}

