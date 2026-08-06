// ── 공유 전역 상태 (ui-core.js에서 canvas/ctx/W/H 초기화) ────────────────
let canvas, ctx, W, H, DPR = 1;
let WORLD_CX = 0, WORLD_CY = 0;
let scale = 0.85, panX = 0, panY = 0;
let nodes = [], edges = [], nodeMap = {};
// 노드 id 접두사 일련번호 — 같은 밀리초에 여러 파일을 임포트해도(폴더 임포트 루프) id가 겹치지 않게
let _idSeq = 0;
let drag = null, hoveredNode = null;
let isPanning = false, panStartX = 0, panStartY = 0, panStartOffsetX = 0, panStartOffsetY = 0;
let isStable = false;
let CONFIG = { repulsion: 500, gravity: 0.0010, linkDistance: 60, nodeSize: 1.0, linkWidth: 1.5, linkTension: 0.005 };
let searchKeyword = '', searchMatches = new Set();
let searchDirect = new Set(); // 키워드 직접 매칭 노드(글로우 대상). searchMatches는 조상 경로 포함
let _showLabels = true;
let _labelScale = (() => { try { const v = parseFloat(localStorage.getItem('snlog_label_scale')); return (v >= 0.5 && v <= 2.5) ? v : 1; } catch(e) { return 1; } })();
// 제목 뒤 지움 — 글자 모양대로 배경색을 페더로 덮어, 겹친 링크선·노드를 글자 주변에서 빼준다
let _labelKnockout = (() => { try { return localStorage.getItem('snlog_label_knockout') !== 'false'; } catch(e) { return true; } })();
// 색의 원본은 CSS 토큰(:root) — JS는 한 번 읽어 캐시만 한다(매 프레임 조회는 비싸다)
const _cssRgbCache = {};
function cssRgb(name, fallback) {
  if (!_cssRgbCache[name]) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    const p = String(v).split(',').map(x => parseInt(x, 10));
    _cssRgbCache[name] = (p.length === 3 && p.every(x => x >= 0 && x <= 255)) ? p : fallback;
  }
  return _cssRgbCache[name];
}
const bgRgb = () => cssRgb('--graph-bg-rgb', [12,13,18]);       // 캔버스 배경 = 라벨 뒤를 파낼 색
const satelliteRgb = () => cssRgb('--satellite-rgb', [255,214,74]); // 위성 모드 제목 색
// 뷰 회전(라디안) — 노드 위치는 그대로, 보는 각도만 회전. 라벨은 화면좌표로 따로 그려 항상 수평
let _viewRotation = (() => { try { const v = parseFloat(localStorage.getItem('snlog_rotation')); return isFinite(v) ? v : 0; } catch(e) { return 0; } })();

// 노드 연결(위키링크 엣지) 표시 여부
let _showConnections = (() => { try { return localStorage.getItem('snlog_show_conn') !== 'false'; } catch(e) { return true; } })();
// 그래프 배치 모드: 'force'(힘기반·기본) | 'radial'(방사형 트리) | 'cluster'(페이지별 클러스터)
// 저장값이 없으면 방사형이 기본 — 처음 여는 사람에게 계층이 한눈에 보인다
let _layoutMode = (() => { try { const v = localStorage.getItem('snlog_layout'); return (v === 'force' || v === 'cluster') ? v : 'radial'; } catch(e) { return 'radial'; } })();
let _layoutSig = -1; // 마지막 트리 배치 시 노드 수(변하면 재배치)
let _pageAnchors = null, _clusterSig = -1; // 클러스터 모드: 페이지별 중력 앵커

let _focusMode = false, _focusNodeId = null;
let _connectMode = false, _connectFirstNode = null;
let _fitAnimId = null;
let _multiSelected = [], _isolateActive = false;

// 호버 강조 사슬 — 조상(루트까지) + 하위 트리 전체. 구조 링크만 따라간다(약한·수동 링크 제외).
let _hoverChainId = null, _hoverChain = new Set();
function _computeHoverChain(n) {
  const s = new Set();
  if (!n) return s;
  s.add(n.id);
  let cur = n.id;
  for (let g = 0; g < 50; g++) { const pe = getParentEdge(cur); if (!pe) break; cur = pe.from; s.add(cur); }
  const q = [n.id]; // 아래로는 호버 노드에서만 뻗는다 — 조상의 다른 자식(형제)은 포함하지 않음
  while (q.length) {
    const id = q.shift();
    edges.forEach(ed => { if (ed.from === id && !ed.weakLink && !ed.manualLink && !s.has(ed.to)) { s.add(ed.to); q.push(ed.to); } });
  }
  return s;
}
// 흰색 글로우를 붙일 '활성 노드' — 검색은 searchDirect가, 포커스/경로찾기는 이 집합이 담당
let _activeGlowIds = new Set();
let _satelliteRemovedEdges = [];

// 노드 색상 표현: 'node'=노드별 색(기본), 'depth'=헤딩 깊이별 색(#,##,###,####)
let _colorScheme = (() => { try { return localStorage.getItem('snlog_color_scheme') || 'node'; } catch(e) { return 'node'; } })();
// 깊이별 색(성운 팔레트): #전기시안 ##비비드퍼플 ###마젠타핑크 ####코랄앰버 (페이지·DB·최상위는 흰색)
const DEPTH_RGB = { 1:[0,207,255], 2:[168,85,247], 3:[255,77,184], 4:[255,140,66], 5:[255,210,74] };
function depthRgb(n) {
  // 최상위·페이지·DB 노드는 흰색 (깊이 색은 노션 헤딩에만)
  if (n.level === 0 || n.isChildPage || n.isDbNode || n.entryNotionId) return [245,247,250];
  const d = n.headingDepth || n.level || 1;
  return DEPTH_RGB[Math.min(d, 5)] || [180,190,200];
}
function nodeRgb(n) { return _colorScheme === 'depth' ? depthRgb(n) : n._rgb; }

// ── 마크다운 → 그래프 파싱 ──────────────────────────────────────────

function parseMarkdown(text, rootTitle) {
  const nodes = [], edges = [], nodeMap = {};
  let nid = 0;

  function addNode(rawLabel, desc='', parentId=null, date='', level=0) {
    // 라벨은 항상 평문(검색·매칭·색·안정키). 서식 원문은 아래 labelMd에 따로 보관
    const label = plainLabel(rawLabel);
    if (!label || label.length < 1) return null;
    const rawMd = String(rawLabel || '').trim();
    const parentNode = nodeMap[parentId];
    let color = null;
    if (level === 0) { color = '#ffffff'; }
    else if (level === 1) { color = getH1Color(label); }
    else if (level === 2) {
      const parentColor = parentNode?.color;
      if (parentColor) {
        const parentHue = extractHue(parentColor);
        const siblingCount = edges.filter(e => e.from === parentId).length;
        const hueOffset = (siblingCount * 47) % 120 - 60;
        color = hslColor((parentHue + hueOffset + 360) % 360, 90, 60);
      } else { color = getH1Color(label); }
    } else if (level === 3) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), 90, 52);
    } else if (level === 4) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), Math.max(getSaturation(parentColor), 88), 41);
    } else if (level === 5) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), Math.max(getSaturation(parentColor), 88), 30);
    }
    const id = 'n' + (nid++);
    const n = {
      id, label, desc: cleanDesc(desc), date,
      x: W/2 + (Math.random()-0.5)*60, y: H/2 + (Math.random()-0.5)*60,
      vx: 0, vy: 0, level, fixed: false, color,
      _rgb: hexToRgb(level === 0 ? '#ffffff' : (color || '#74b9ff'))
    };
    if (rawMd && rawMd !== label) n.labelMd = rawMd; // 서식이 있을 때만 — 칩이 볼드·기울임을 그대로 표시
    nodes.push(n); nodeMap[id] = n;
    if (parentId) edges.push({ from: parentId, to: id });
    return id;
  }

  const rootId = addNode(rootTitle || '자기관리: 내면', '', null, '', 0);
  if (rootId) nodeMap[rootId].headingDepth = 0; // 페이지 제목은 헤딩이 아님 — #레벨 0으로 구분
  const currentParents = { 0: rootId, 1: null, 2: null, 3: null, 4: null, 5: null };
  const lines = text.split('\n');
  let sawHeading = false;

  // 한 노드에 딸린 본문 줄 모으기 — 헤딩 다음 줄부터, 다음 헤딩/구조 마커를 만날 때까지.
  // (헤딩 분기 안에 있던 코드를 꺼낸 것 — 페이지 맨 앞 본문에도 같은 규칙을 쓰기 위해)
  function collectBody(startIdx) {
    const descLines = [], bodyBlocks = [];
    let curBlk = null, nextIdx = startIdx, date = '';
    const flushBlk = () => { if (curBlk) { bodyBlocks.push({ id: curBlk.id, text: curBlk.lines.join('\n'), mark: curBlk.mark || '', type: curBlk.type || 'paragraph', checked: !!curBlk.checked }); curBlk = null; } };
    while (nextIdx < lines.length) {
      const rawLine = lines[nextIdx].replace(/\s+$/, '');
      const nextLine = rawLine.trim();
      if (!nextLine) { nextIdx++; continue; }
      if (nextLine.startsWith('#')) break;
      if (nextLine === '[DB_NODE]') break;
      if (nextLine === '[CHILD_PAGE]') break;
      if (nextLine === '[TGL]') break;
      if (nextLine.startsWith('[NOTION_ENTRY:')) break;
      if (nextLine.startsWith('[BLOCK:')) break;
      const bbm = nextLine.match(/^\[BB:([a-f0-9]+)\]$/);
      if (bbm) { flushBlk(); curBlk = { id: bbm[1], lines: [] }; nextIdx++; continue; }
      const dateOnlyMatch = nextLine.match(/^-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-$/);
      if (dateOnlyMatch) { date = date || dateOnlyMatch[1]; nextIdx++; continue; }
      // (제거) 홀로 있는 볼드 줄에서 본문 수집을 끊던 휴리스틱 — 그 뒤 내용을 노드로 만들지도 않고
      // 그냥 버려서, 볼드 소제목이 여러 개인 콜아웃/본문의 뒷부분이 desc·bodyBlocks에서 통째로 사라졌음.
      if (descLines.join('\n').length > 20000) { nextIdx++; continue; }
      descLines.push(rawLine);
      // 한 블록의 모든 줄(소프트 줄바꿈 포함) 수집 + 첫 줄에서 목록 마커·블록 유형·체크 상태 캡처
      if (curBlk) { if (!curBlk.lines.length) { curBlk.mark = _listMark(rawLine); curBlk.type = _blockTypeOf(rawLine); curBlk.checked = _blockChecked(rawLine); } curBlk.lines.push(bodyBlockText(rawLine)); }
      nextIdx++;
    }
    flushBlk();
    return { descLines, bodyBlocks, date, nextIdx };
  }

  // 첫 헤딩보다 앞에 있는 본문(페이지 맨 위에 그냥 쓴 글)은 예전엔 어느 노드에도 안 붙어 통째로 사라졌다 → 루트 노드 본문으로
  if (rootId) {
    const head = collectBody(0);
    if (head.descLines.length) {
      nodeMap[rootId].desc = cleanDesc(head.descLines.join('\n').substring(0, 20000));
      if (head.bodyBlocks.length) nodeMap[rootId].bodyBlocks = head.bodyBlocks;
      if (head.date) nodeMap[rootId].date = head.date;
    }
  }
  // [DB_NODE]로 만든 직전 노드 — 뒤따르는 [NOTION_ENTRY] 항목들의 부모
  let lastDbNodeId = null;
  let pendingEntryId = null;
  let pendingIsDbNode = false;
  let pendingIsChildPage = false;
  let pendingBlockId = null;
  let pendingParentId = null;
  let pendingToggle = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('---') || line.startsWith('<')) continue;
    if (line === '[TGL]') { pendingToggle = true; continue; }
    if (line === '[DB_NODE]') { pendingIsDbNode = true; continue; }
    if (line === '[CHILD_PAGE]') { pendingIsChildPage = true; continue; }
    const entryMarker = line.match(/^\[NOTION_ENTRY:([a-f0-9]+)\]$/);
    if (entryMarker) { pendingEntryId = entryMarker[1]; continue; }
    const blockMarker = line.match(/^\[BLOCK:([a-f0-9]+)(?:\|([a-f0-9]+))?\]$/);
    if (blockMarker) { pendingBlockId = blockMarker[1]; pendingParentId = blockMarker[2] || null; continue; }
    const headerMatch = line.match(/^(#{1,5})\s+(.*)$/);
    if (headerMatch) {
      const rawDepth = headerMatch[1].length;
      const depth = Math.min(rawDepth, 5);
      const isFirstHeading = !sawHeading;
      sawHeading = true;
      // 서식 마커는 여기서 떼지 않는다 — addNode가 평문 라벨을 뽑고 원문은 labelMd로 보관
      let lbl = headerMatch[2].trim();
      let nDate = '';
      const inlineDateMatch = lbl.match(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/);
      if (inlineDateMatch) { nDate = inlineDateMatch[1]; lbl = lbl.replace(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/, ''); }
      // 구조 노드(DB·DB 항목·하위 페이지)인가 — 헤딩 계층에 끼어들면 안 되는 것들
      const isStruct = !!(pendingEntryId || pendingIsDbNode || pendingIsChildPage);
      const isDbEntry = !!(pendingEntryId && !pendingIsDbNode && !pendingIsChildPage && lastDbNodeId);
      let parentId = null;
      if (isDbEntry) parentId = lastDbNodeId; // DB 항목은 바로 앞 DB 노드 밑으로
      else for (let d = depth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }
      if (!parentId) parentId = rootId;
      const col = collectBody(i + 1);
      const descLines = col.descLines, bodyBlocks = col.bodyBlocks, nextIdx = col.nextIdx;
      if (col.date) nDate = nDate || col.date;
      // 파일 맨 앞의 # 제목이 페이지 제목(파일명)과 같으면 헤딩 노드로 쪼개지 않고 루트에 흡수 —
      // 같은 이름 노드가 둘로 갈라지던 문제. 원본 파일 복원용으로 titleHeading 표시.
      // 노션 본문(BLOCK/ENTRY 마커 동반)은 블록 ID를 잃으면 편집이 깨지므로 제외.
      const noNotionMarker = !pendingEntryId && !pendingBlockId && !pendingToggle && !pendingIsDbNode && !pendingIsChildPage;
      if (isFirstHeading && rawDepth === 1 && rootId && noNotionMarker && plainLabel(lbl) === nodeMap[rootId].label) {
        const rn = nodeMap[rootId];
        rn.titleHeading = true;
        // 제목 헤딩 앞에 이미 본문이 있었다면(위에서 루트에 담아둔 것) 덮어쓰지 말고 이어 붙인다
        rn.desc = cleanDesc([rn.desc, descLines.join('\n')].filter(s => s && s.trim()).join('\n').substring(0, 20000));
        if (nDate) rn.date = nDate;
        if (bodyBlocks.length) rn.bodyBlocks = (rn.bodyBlocks || []).concat(bodyBlocks);
        if (nextIdx > i + 1) i = nextIdx - 1;
        continue;
      }
      const curId = addNode(lbl, descLines.join('\n').substring(0, 20000), parentId, nDate, depth);
      if (curId) {
        nodeMap[curId].headingDepth = rawDepth;
        if (bodyBlocks.length) nodeMap[curId].bodyBlocks = bodyBlocks;
        if (pendingEntryId) { nodeMap[curId].entryNotionId = pendingEntryId; pendingEntryId = null; }
        if (pendingBlockId) { nodeMap[curId].notionBlockId = pendingBlockId; nodeMap[curId].notionParentId = pendingParentId; pendingBlockId = null; pendingParentId = null; }
        if (pendingToggle) { nodeMap[curId].notionToggle = true; pendingToggle = false; }
        if (pendingIsDbNode) { nodeMap[curId].isDbNode = true; pendingIsDbNode = false; }
        if (pendingIsChildPage) { nodeMap[curId].isChildPage = true; pendingIsChildPage = false; }
        if (isStruct) {
          // 구조 노드는 헤딩 스택에 넣지 않는다 — 넣으면 그 뒤에 오는 진짜 헤딩이 DB·하위 페이지 밑으로
          // 딸려 들어가 계층이 통째로 어긋났다. DB 노드만 뒤따르는 항목들의 부모로 기억.
          lastDbNodeId = nodeMap[curId].isDbNode ? curId : lastDbNodeId;
        } else {
          lastDbNodeId = null;
          currentParents[depth] = curId;
          for (let d = depth + 1; d <= 5; d++) currentParents[d] = null;
        }
      }
      if (nextIdx > i + 1) i = nextIdx - 1;
    }
  }
  return { nodes, edges, nodeMap };
}

// ── 물리 시뮬레이션 ─────────────────────────────────────────────────

function simulate() {
  // 방사형 배치: 물리 끄고 계산 좌표 유지. 노드 수 바뀌면(페이지 로드/삭제 등) 재배치
  if (_layoutMode === 'radial') {
    if (nodes.length !== _layoutSig) applyTreeLayout();
    return;
  }
  if (isStable && !drag) return;
  // 페이지별 클러스터: 페이지마다 중력 앵커를 따로 둬서 섬처럼 뭉침. 페이지 집합 바뀌면 앵커 재계산
  const clusterMode = _layoutMode === 'cluster';
  if (clusterMode && (!_pageAnchors || nodes.length !== _clusterSig)) { _pageAnchors = computePageAnchors(); _clusterSig = nodes.length; }
  const repulsion = CONFIG.repulsion, damping = 0.92, centerForce = CONFIG.gravity;
  const fixedDescendants = new Set();
  nodes.filter(n => n.fixed && n.visible).forEach(fn => {
    const q=[fn.id], v=new Set([fn.id]);
    while(q.length){ const id=q.shift(); edges.forEach(e=>{ if(e.from===id&&!e.weakLink&&!v.has(e.to)){v.add(e.to);fixedDescendants.add(e.to);q.push(e.to);} }); }
  });
  const activeNodes = nodes.filter(n => n.visible && !n.fixed && !n._frozen && n !== drag);
  let totalVelocity = 0;
  activeNodes.forEach(n => {
    let fx = 0, fy = 0;
    const nKey = clusterMode ? (n.sourcePageId || '_root') : null;
    nodes.forEach(m => {
      if(m === n || !m.visible) return;
      const dx = n.x-m.x, dy = n.y-m.y, d = Math.max(dist(n,m), 1);
      // 클러스터 모드: 다른 페이지끼리는 더 멀리·세게 밀어내 섬을 분리
      const diffPage = clusterMode && (m.sourcePageId || '_root') !== nKey;
      const range = diffPage ? 750 : 400;
      if(d < range) { const f = repulsion * (diffPage ? 2.4 : 1)/(d*d); fx += dx/d*f; fy += dy/d*f; }
    });
    edges.forEach(e => {
      if(e.from !== n.id && e.to !== n.id) return;
      const other = nodeMap[e.from===n.id?e.to:e.from];
      if(!other||!other.visible) return;
      if(other.fixed && e.from === n.id) return;
      const dx = other.x-n.x, dy = other.y-n.y, d = Math.max(dist(n,other), 1);
      let natural = CONFIG.linkDistance, strength = CONFIG.linkTension;
      if(e.wikiLink) return; // 위키링크({{ }})는 렌더만, 레이아웃 힘 없음
      if(e.weakLink) { natural = 600; strength = 0.001; }
      else if(e.manualLink) { return; }
      else {
        if(n.level===1||other.level===1) natural *= 1.2;
        if(n.level>=3||other.level>=3) natural *= 0.9;
      }
      const f = (d-natural)*strength;
      fx += dx/d*f; fy += dy/d*f;
    });
    if(fixedDescendants.has(n.id)){}
    else if(n._satellite){
      const sdx=n.x-WORLD_CX, sdy=n.y-WORLD_CY, sd=Math.max(Math.sqrt(sdx*sdx+sdy*sdy),1);
      const sf=(sd-700)*0.0016; fx-=sdx/sd*sf; fy-=sdy/sd*sf;
    }
    else if(clusterMode){
      const a = (_pageAnchors && _pageAnchors[nKey]) || { x: WORLD_CX, y: WORLD_CY };
      fx += (a.x-n.x)*centerForce; fy += (a.y-n.y)*centerForce;
    }
    else { fx += (WORLD_CX-n.x)*centerForce; fy += (WORLD_CY-n.y)*centerForce; }
    n.vx = Math.max(-3, Math.min(3, (n.vx+fx)*damping));
    n.vy = Math.max(-3, Math.min(3, (n.vy+fy)*damping));
    n.x += n.vx; n.y += n.vy;
    const speed = Math.abs(n.vx) + Math.abs(n.vy);
    totalVelocity += speed;
    if (speed < 0.05) { n._frozenFrames = (n._frozenFrames || 0) + 1; if (n._frozenFrames > 120) n._frozen = true; }
    else n._frozenFrames = 0;
  });
  if (totalVelocity < 2.0 && !drag) isStable = true;
}

// ── 렌더링 ──────────────────────────────────────────────────────────

// 노드 배지 속 글리프 — 화면에서 항상 같은 크기로 보이게 좌표를 scale로 나눈다
function _drawCheck(ctx, bx, by, scale) {
  ctx.beginPath();
  ctx.moveTo(bx - 3.2/scale, by + 0.3/scale);
  ctx.lineTo(bx - 0.8/scale, by + 2.6/scale);
  ctx.lineTo(bx + 3.4/scale, by - 2.4/scale);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.7/scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}
function _drawPencil(ctx, bx, by, scale) {
  const s = v => v/scale;
  ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = 1.9/scale;
  ctx.beginPath(); ctx.moveTo(bx - s(2.6), by + s(2.6)); ctx.lineTo(bx + s(2.4), by - s(2.4)); ctx.stroke(); // 몸통
  ctx.lineWidth = 1.3/scale;
  ctx.beginPath(); ctx.moveTo(bx + s(0.5), by - s(2.9)); ctx.lineTo(bx + s(2.9), by - s(0.5)); ctx.stroke(); // 지우개 쪽 띠
  ctx.beginPath(); ctx.moveTo(bx - s(3.2), by + s(3.2)); ctx.lineTo(bx - s(1.7), by + s(2.6)); ctx.stroke(); // 촉
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=rgbStr(bgRgb(),1); ctx.fillRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2+panX, H/2+panY);
  ctx.scale(scale, scale);
  if (_viewRotation) ctx.rotate(_viewRotation);
  ctx.translate(-W/2, -H/2);
  const labelQueue = [], glowQueue = []; // 활성 글로우는 모든 노드를 그린 뒤 맨 앞 레이어로
  const hasSearch = searchKeyword.length > 0;
  const childCountMap = new Map(), manualLinkedSet = new Set();
  edges.forEach(e => {
    if (!e.weakLink && !e.manualLink) childCountMap.set(e.from, (childCountMap.get(e.from) || 0) + 1);
    if (e.manualLink) { manualLinkedSet.add(e.from); manualLinkedSet.add(e.to); }
  });
  // 우측 패널에 열린 노드 → 표시용(id → 스택 순번 1=위,2=아래)
  const openPanelIdx = new Map();
  if (typeof _stack !== 'undefined' && _stack) _stack.forEach((nd, i) => { if (nd) openPanelIdx.set(nd.id, i + 1); });
  // 그 노드가 어디에 속하는지 한눈에 — 상세 패널 노드의 상위는 녹색, 선택한 노드의 상위는 주황 링
  const panelAnc = new Set(), selAnc = new Set();
  if (typeof getAncestorIds === 'function') {
    if (typeof _stack !== 'undefined' && _stack) _stack.forEach(nd => { if (nd) getAncestorIds(nd.id, 20).forEach(id => panelAnc.add(id)); });
    if (typeof _multiSelected !== 'undefined' && _multiSelected) _multiSelected.forEach(nd => { if (nd) getAncestorIds(nd.id, 20).forEach(id => selAnc.add(id)); });
  }

  // 위키(노드연결) 엣지를 먼저 그려 맨 아래 레이어로 → 기본 구조 링크선이 위에 오게
  // 호버 강조 대상 = 조상 사슬(위로 루트까지) + 하위 트리 전체(아래로).
  // 호버 노드가 바뀔 때만 다시 계산 — 매 프레임 BFS는 비싸다.
  if (!hoveredNode) { _hoverChainId = null; _hoverChain.clear(); }
  else if (hoveredNode.id !== _hoverChainId) { _hoverChainId = hoveredNode.id; _hoverChain = _computeHoverChain(hoveredNode); }
  [...edges].sort((a, b) => (a.wikiLink ? 0 : 1) - (b.wikiLink ? 0 : 1)).forEach(e => {
    const na=nodeMap[e.from], nb=nodeMap[e.to];
    if(!na||!nb||!na.visible||!nb.visible) return;
    const isHov = hoveredNode && _hoverChain.has(e.from) && _hoverChain.has(e.to);
    const bothMatch = hasSearch&&searchMatches.has(e.from)&&searchMatches.has(e.to);
    const eitherMatch = hasSearch&&(searchMatches.has(e.from)||searchMatches.has(e.to));
    if(e.wikiLink) {
      // 노드연결: 흰색 점선 한 줄 + A→B 화살표 (글로우 제거 → 한 줄로)
      if(!_showConnections) return; // 노드 연결 표시 끔
      // 양쪽이 다 활성일 때만 그린다 — 한쪽만 활성인데 선이 남으면 상대 노드까지 활성처럼 보임
      if(hasSearch && !bothMatch) return;
      if((_focusMode||_isolateActive) && (na.dimmed || nb.dimmed)) return;
      ctx.strokeStyle = `rgba(255,255,255,${isHov ? 0.8 : 0.35})`;
      ctx.lineWidth = (isHov ? 1.6 : 1.0) * CONFIG.linkWidth / scale; ctx.setLineDash([5, 6]);
    } else if(e.manualLink) {
      if(hasSearch && !bothMatch) return; // 수동 연결도 노드연결과 같은 규칙
      if((_focusMode||_isolateActive) && (na.dimmed || nb.dimmed)) return;
      ctx.strokeStyle = `rgba(255,255,255,${isHov ? 0.7 : 0.35})`;
      ctx.lineWidth = (isHov ? 1.8 : 1.2) * CONFIG.linkWidth / scale; ctx.setLineDash([5, 6]);
    } else if(e.weakLink) {
      if((_focusMode||_isolateActive) && na.dimmed && nb.dimmed) return;
      const pathActive = (_focusMode||_isolateActive) && !na.dimmed && !nb.dimmed;
      if(pathActive) { ctx.strokeStyle = `rgba(237,112,0,${isHov?0.95:0.85})`; ctx.lineWidth = (isHov?2.2:1.6)*CONFIG.linkWidth/scale; ctx.setLineDash([8,4]); }
      else { ctx.strokeStyle = `rgba(237,112,0,${isHov?0.6:0.25})`; ctx.lineWidth = CONFIG.linkWidth/scale; ctx.setLineDash([6,6]); }
    } else if(hasSearch) {
      if((_focusMode||_isolateActive) && na.dimmed && nb.dimmed) return;
      const focusDim = (_focusMode||_isolateActive) && (na.dimmed || nb.dimmed);
      const eRgb = nodeRgb(nb); // 선 색은 하위(도착) 노드 기준 — 아래 규칙과 동일
      if(bothMatch) { ctx.strokeStyle=rgbStr(eRgb,focusDim?0.15:0.9); ctx.lineWidth=(focusDim?0.6:1.6)/scale; ctx.setLineDash([]); }
      else if(eitherMatch) { ctx.strokeStyle=rgbStr(eRgb,focusDim?0.06:0.35); ctx.lineWidth=(focusDim?0.4:0.8)/scale; ctx.setLineDash([]); }
      else { ctx.strokeStyle=rgbStr(eRgb,0.05); ctx.lineWidth=0.5/scale; ctx.setLineDash([]); }
    } else {
      if((_focusMode||_isolateActive) && na.dimmed && nb.dimmed) return;
      const isDimEdge = (_focusMode||_isolateActive) && (na.dimmed || nb.dimmed);
      // 호버 강조가 사슬 전체(조상+하위)로 넓어져 굵은 선이 한꺼번에 많아진다 →
      // 두께 배수는 낮추고(2.2→1.5) 밝기로 존재감을 채운다(0.85→0.95)
      const alpha=isDimEdge?0.08:(isHov?0.95:0.55), width=isDimEdge?0.5:(isHov?1.5:1.0);
      // 호버 사슬은 흰색 — 노드 색 그대로 굵어지면 원래 밝던 가지와 구분이 잘 안 됐다
      // (노드연결·수동연결 선이 이미 흰색이라 강조 색이 한 종류로 통일된다)
      // 선 색은 하위(도착) 노드가 정한다 — 가지 끝으로 갈수록 그 가지의 색이 이어져 계통이 읽힌다
      // (상위 노드 기준이면 한 부모의 자식들이 전부 같은 색이라 어느 가지인지 구분이 안 됐다)
      const eRgb = isHov ? cssRgb('--fg-rgb', [255,255,255]) : nodeRgb(nb);
      // 자식이 깊을수록 가늘게 — 굵은 쪽이 상위라, 선만 봐도 어느 방향이 위인지 읽힌다
      ctx.strokeStyle=rgbStr(eRgb,alpha);
      ctx.lineWidth=width*edgeDepthScale(nb.level)*CONFIG.linkWidth/scale; ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke();
    ctx.setLineDash([]);
    if(e.wikiLink) {
      // A→B 방향 화살표 (B 노드 앞에). 크기를 노드 크기(월드)에 비례 → 줌 축소 시 함께 작아짐
      const rNb = nodeR(nb.level);
      const ang = Math.atan2(nb.y-na.y, nb.x-na.x);
      const rB = rNb + 2;
      const tipX = nb.x - Math.cos(ang)*rB, tipY = nb.y - Math.sin(ang)*rB;
      const ah = Math.max(rNb * 1.15, 3/scale); // 노드 비례(최소 화면 3px)
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang-0.42)*ah, tipY - Math.sin(ang-0.42)*ah);
      ctx.lineTo(tipX - Math.cos(ang+0.42)*ah, tipY - Math.sin(ang+0.42)*ah);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${isHov?0.85:0.5})`; ctx.fill();
    }
  });

  if(hasSearch && searchMatches.size > 0) {
    const matchArr = [...searchMatches].map(id => nodeMap[id]).filter(n => n && n.visible);
    function getPath(node) {
      const path = [node]; let cur = node;
      for(let depth=0; depth<10; depth++) {
        const parentEdge = edges.find(e => e.to===cur.id && !e.weakLink);
        if(!parentEdge) break;
        const parent = nodeMap[parentEdge.from]; if(!parent) break;
        path.unshift(parent); cur = parent;
      }
      return path;
    }
    const existingEdgeSet = new Set(edges.filter(e => !e.weakLink).map(e => [e.from,e.to].sort().join('|')));
    const drawnPairs = new Set();
    ctx.setLineDash([4,6]); ctx.lineWidth = 1.2*CONFIG.linkWidth/scale;
    matchArr.forEach(n => {
      const path = getPath(n);
      for(let i=0; i<path.length-1; i++) {
        const a=path[i], b=path[i+1];
        if(!a.visible||!b.visible) continue;
        if((_focusMode||_isolateActive) && a.dimmed && b.dimmed) continue;
        if(a.level===1&&b.level===1) continue;
        const key=[a.id,b.id].sort().join('|');
        if(drawnPairs.has(key)||existingEdgeSet.has(key)) continue;
        drawnPairs.add(key);
        ctx.strokeStyle=rgbStr(hexToRgb(b.color||a.color||'#ed7000'),0.75);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    });
    const matchedRoots = new Set();
    matchArr.forEach(n => { const path=getPath(n); const rootNode=path.find(p=>p.level===0); if(rootNode) matchedRoots.add(rootNode); });
    const rootArr=[...matchedRoots];
    if(rootArr.length>1) {
      ctx.lineWidth=1.5/scale; ctx.setLineDash([6,5]);
      for(let i=0; i<rootArr.length-1; i++) {
        const a=rootArr[i], b=rootArr[i+1];
        if(!a.visible||!b.visible) continue;
        if((_focusMode||_isolateActive) && a.dimmed && b.dimmed) continue;
        const key=[a.id,b.id].sort().join('|');
        if(drawnPairs.has(key)) continue;
        drawnPairs.add(key);
        ctx.strokeStyle=rgbStr(hexToRgb(a.color||'#ed7000'),0.9);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  nodes.forEach(n => {
    if(!n.visible) return;
    const isHov=hoveredNode===n, isMatch=searchMatches.has(n.id);
    const isDirectMatch=searchDirect.has(n.id)||_activeGlowIds.has(n.id);
    const isDim=(hasSearch&&!isMatch)||((_focusMode||_isolateActive)&&n.dimmed);
    const r=nodeR(n.level);
    const ndRgb = nodeRgb(n);
    const nodeColor = n.level===0 ? '#ffffff' : (n.color||'#74b9ff');
    const isManualLinked = manualLinkedSet.has(n.id);
    // 뷰 회전 시: 노드 위치는 회전된 자리, 모양(별·선택표시·위성 등)은 똑바로 유지 — 역회전 적용
    ctx.save();
    if(_viewRotation){ ctx.translate(n.x, n.y); ctx.rotate(-_viewRotation); ctx.translate(-n.x, -n.y); }
    if(isManualLinked && !isDim) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r+14, 0, Math.PI*2);
      const gM = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+14);
      gM.addColorStop(0, 'rgba(255,255,255,0.35)'); gM.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gM; ctx.fill();
    }
    if(!isDim && n.level > 0) {
      const childCount = childCountMap.get(n.id) || 0;
      if(childCount >= 3) {
        const hubStrength = Math.min((childCount - 2) / 4, 1);
        const glowR = r + 8 + hubStrength * 22;
        ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI*2);
        const gH = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, glowR);
        gH.addColorStop(0, rgbStr(ndRgb, 0.28 + hubStrength * 0.15)); gH.addColorStop(1, rgbStr(ndRgb, 0));
        ctx.fillStyle = gH; ctx.fill();
      }
    }
    if(isDirectMatch) glowQueue.push({ x: n.x, y: n.y, r }); // 그리기는 마지막 패스에서(다른 노드에 안 가리게)
    else if(isHov) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+12,0,Math.PI*2);
      const g=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+12);
      g.addColorStop(0,rgbStr(ndRgb,0.3)); g.addColorStop(1,rgbStr(ndRgb,0));
      ctx.fillStyle=g; ctx.fill();
    }
    if(n.level===0) drawStar8(ctx, n.x, n.y, r);
    else if(n.isDbNode) drawStar4(ctx, n.x, n.y, r);
    else if(n.isChildPage || n.entryNotionId) drawStarX(ctx, n.x, n.y, r);
    else { ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2); }
    // 직접 히트만 흰색 — 흰 글로우와 한 덩어리로 읽히게. 조상·관련 노드는 자기 색 유지
    // (예전엔 조상까지 포함하는 isMatch 기준이라 상위 계층이 전부 하얘졌다)
    if(isDirectMatch) { ctx.fillStyle='#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else if(n.level===0) { ctx.fillStyle=isDim?'rgba(245,247,250,0.15)':'#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else {
      // 깊이별 명도는 HSL 단계에서 처리 — 여기선 배경 혼합 없이 원색 그대로(쨍하게)
      ctx.fillStyle=isDim?rgbStr(ndRgb,0.15):rgbStr(ndRgb,1);
      ctx.strokeStyle=isDim?rgbStr(ndRgb,0.06):rgbStr(ndRgb,1);
      ctx.lineWidth=isHov?2/scale:1/scale; ctx.fill(); ctx.stroke();
    }
    // 상위 계층 링 — 둘 다 해당되면 반지름을 달리해 겹쳐도 둘 다 보이게
    if(!isDim && (panelAnc.has(n.id) || selAnc.has(n.id))) {
      const ring = (rad, color) => { ctx.beginPath(); ctx.arc(n.x, n.y, rad, 0, Math.PI*2); ctx.strokeStyle = color; ctx.lineWidth = 1.6/scale; ctx.stroke(); };
      if(panelAnc.has(n.id)) ring(r+4.5, 'rgba(39,174,96,0.85)');
      if(selAnc.has(n.id)) ring(r+7.5, rgbStr(cssRgb('--accent-rgb',[237,112,0]), 0.85));
    }
    if(n.fixed) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+3.5,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=1/scale;
      ctx.setLineDash([2.5,2.5]); ctx.stroke(); ctx.setLineDash([]);
    }
    if(_connectMode && n.connectSelected) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r+16, 0, Math.PI*2);
      const gSel = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+16);
      gSel.addColorStop(0, 'rgba(255,255,255,0.45)'); gSel.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gSel; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, r+7, 0, Math.PI*2);
      const gSel2 = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+7);
      gSel2.addColorStop(0, 'rgba(255,255,255,0.6)'); gSel2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gSel2; ctx.fill();
    }
    if(_connectMode && _connectFirstNode && !n.connectSelected) {
      const alreadyLinked = edges.some(e => (e.manualLink || e.wikiLink) && ((e.from === _connectFirstNode.id && e.to === n.id) || (e.from === n.id && e.to === _connectFirstNode.id)));
      if(alreadyLinked) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r+16, 0, Math.PI*2);
        const gDel = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+16);
        gDel.addColorStop(0, 'rgba(255,80,80,0.4)'); gDel.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = gDel; ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r+7, 0, Math.PI*2);
        const gDel2 = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+7);
        gDel2.addColorStop(0, 'rgba(255,80,80,0.55)'); gDel2.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = gDel2; ctx.fill();
      }
    }
    if(n.multiSelected) {
      const acc = rgbStr(cssRgb('--accent-rgb',[237,112,0]), 1);
      ctx.beginPath(); ctx.arc(n.x, n.y, r+8, 0, Math.PI*2);
      ctx.strokeStyle = acc; ctx.lineWidth = 2/scale; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      const order = _multiSelected.indexOf(n) + 1;
      if (order > 0) {
        const bx = n.x + r + 5, by = n.y - r - 5, rr = 7/scale;
        ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI*2);
        ctx.fillStyle = acc; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1/scale; ctx.stroke();
        // 여럿 고르면 순번이 필요하다(순서대로 연결) → 그때만 숫자, 하나면 체크
        if (_multiSelected.length > 1) {
          ctx.fillStyle = '#15110a'; ctx.font = `bold ${10/scale}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(order, bx, by);
          ctx.textAlign='start'; ctx.textBaseline='alphabetic';
        } else {
          _drawCheck(ctx, bx, by, scale);
        }
      }
    }
    // 우측 패널에 열린 노드: 녹색 체크 배지 + 은은한 녹색 글로우(흐려져도 표시)
    if(openPanelIdx.has(n.id)) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r+11, 0, Math.PI*2);
      const gOp = ctx.createRadialGradient(n.x, n.y, r+4, n.x, n.y, r+12);
      gOp.addColorStop(0, 'rgba(46,204,113,0.32)'); gOp.addColorStop(1, 'rgba(46,204,113,0)');
      ctx.fillStyle = gOp; ctx.fill();
      const bx = n.x + r + 5, by = n.y - r - 5, rr = 7/scale;
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI*2);
      ctx.fillStyle = '#27ae60'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1/scale; ctx.stroke();
      _drawPencil(ctx, bx, by, scale);
    }
    ctx.restore();
    if(_showLabels) labelQueue.push({ n, r, isMatch, isDim });
  });
  // 활성(직접 히트) 글로우 — 모든 노드 위에 마지막으로. 안쪽은 구멍을 내 노드 색을 덮지 않는다
  glowQueue.forEach(({ x, y, r }) => {
    const ring = (outer, a0) => {
      const g = ctx.createRadialGradient(x, y, r, x, y, outer);
      g.addColorStop(0, `rgba(255,255,255,${a0})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(x, y, outer, 0, Math.PI * 2);
      ctx.arc(x, y, r, 0, Math.PI * 2, true); // 역방향 → 노드 자리는 비움
      ctx.fillStyle = g; ctx.fill();
    };
    ring(r + 18, 0.25);
    ring(r + 8, 0.45);
  });
  ctx.restore();

  // 라벨은 화면좌표(수평·노드 아래)로 따로 그림 — 뷰 회전과 무관하게 항상 똑바로
  if (_showLabels && labelQueue.length) {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    // 1) 그릴 라벨을 먼저 계산 — 아래에서 '뒤 지움'과 '글자'를 두 패스로 나눠 그린다
    const specs = [];
    labelQueue.forEach(({ n, r, isMatch, isDim }) => {
      const sp = worldToScreen(n.x, n.y);
      const sr = r * scale;
      let lbl = n.label ? n.label.replace(/[\n]/g, ' ') : '';
      if (n.level >= 2 && lbl.length > 14) lbl = lbl.substring(0, 13) + '…';
      if (!lbl) return;
      let fontSize = 10;
      if (n.level === 0 || n.level === 1) fontSize = 12;
      else if (n.level === 2) fontSize = 11;
      fontSize = fontSize * _labelScale * scale;
      const _bmLbl = (typeof isBookmarked === 'function') && isBookmarked(n);
      specs.push({
        lbl, x: sp.x, y: sp.y + sr + 5 * scale, fontSize, isDim,
        font: (n.level <= 1) ? `bold ${fontSize}px 'Noto Sans KR',sans-serif` : `500 ${fontSize}px 'Noto Sans KR',sans-serif`,
        // 북마크 주황이 검색 매치(흰색)보다 우선 — 검색 중에도 북마크가 계속 주황으로 보이게.
        // 위성 모드는 노드 위 아이콘 대신 라벨 노란색으로 표시(상태 표시인 위 둘보다는 낮은 우선순위)
        color: _bmLbl ? `rgba(237,112,0,${isDim ? 0.2 : 1})`
          : isMatch ? '#ffffff'
          : n._satelliteRoot ? rgbStr(satelliteRgb(), isDim ? 0.15 : 1)
          : `rgba(215,220,230,${isDim ? 0.12 : 0.85})`
      });
    });
    // 2) 제목 뒤 지움 — 글자를 배경색으로 그리되 그림자 블러(가우시안)를 그대로 페더로 쓴다.
    //    (윤곽선을 두께별로 겹쳐 긋는 방식은 단계가 층으로 보였다 — 블러는 연속이라 층이 안 생김)
    //    캔버스가 불투명 배경이라 '투명하게 파기'(destination-out)는 아래 DOM 배경이 비쳐 얼룩진다 → 같은 색으로 덮는 방식.
    //    흐려진 라벨(검색 비매치·포커스 밖)은 제외 — 존재감이 약한 게 의도인데 주변만 파이면 되레 눈에 띈다.
    if (_labelKnockout) {
      const bg = bgRgb();
      ctx.fillStyle = rgbStr(bg, 1);
      ctx.shadowColor = rgbStr(bg, 1);
      ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      specs.forEach(s => {
        if (s.isDim) return;
        ctx.font = s.font;
        // 그림자 블러는 변환행렬을 안 타므로 장치 픽셀로 환산(DPR). 글자 크기에 비례 + 최소치.
        ctx.shadowBlur = Math.max(2.5, s.fontSize * 0.5) * DPR;
        // 두 번 겹쳐 글자 가까이를 충분히 덮는다 — 가장자리는 여전히 블러라 매끈
        ctx.fillText(s.lbl, s.x, s.y); ctx.fillText(s.lbl, s.x, s.y);
      });
      ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0;
    }
    // 3) 글자
    specs.forEach(s => { ctx.font = s.font; ctx.fillStyle = s.color; ctx.fillText(s.lbl, s.x, s.y); });
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

// ── 그래프 빌드/병합/공개 ────────────────────────────────────────────

function screenToWorld(sx, sy) {
  let rx = (sx-W/2-panX)/scale, ry = (sy-H/2-panY)/scale;
  if (_viewRotation) { const c=Math.cos(-_viewRotation), s=Math.sin(-_viewRotation); const nx=rx*c-ry*s, ny=rx*s+ry*c; rx=nx; ry=ny; }
  return { x: rx+W/2, y: ry+H/2 };
}
function worldToScreen(wx, wy) {
  let dx = wx-W/2, dy = wy-H/2;
  if (_viewRotation) { const c=Math.cos(_viewRotation), s=Math.sin(_viewRotation); const nx=dx*c-dy*s, ny=dx*s+dy*c; dx=nx; dy=ny; }
  return { x: W/2+panX+dx*scale, y: H/2+panY+dy*scale };
}
// 보이는 영역(레일·우측 패널 제외)의 화면 중심 — 회전 축·화면맞춤 기준점
function viewportCenter() {
  const railEl = document.getElementById('activity-rail');
  const sidebarWidth = railEl ? railEl.offsetWidth : 0;
  const ins = _panelInsets(); // 폰(하단 시트)에선 가로가 아니라 세로를 차지
  const availW = W - sidebarWidth - ins.right - 40;
  return { x: sidebarWidth + 20 + availW/2, y: (H - 40 - ins.bottom)/2 + 20 };
}
// 회전 축 기준 무게중심(월드 좌표) — 검색/포커스/경로 활성 시엔 '활성 노드'만, 그 외엔 보이는 전체
function visibleCentroid() {
  let pool = null;
  if (searchKeyword.length > 0 && searchMatches.size > 0) {
    pool = nodes.filter(n => n.visible && searchMatches.has(n.id));
  } else if (_focusMode || _isolateActive) {
    pool = nodes.filter(n => n.visible && !n.dimmed);
  }
  if (!pool || !pool.length) pool = nodes.filter(n => n.visible);
  if (!pool.length) return null;
  let sx = 0, sy = 0;
  for (const nd of pool) { sx += nd.x; sy += nd.y; }
  return { x: sx / pool.length, y: sy / pool.length };
}
// 회전 피벗용 기하학적 중심(바운딩박스 가운데). 무게중심과 달리 노드 밀도에 안 쏠림 —
// 페이지별(cluster) 배치에서 링의 정중앙을 축으로 잡으려고 사용
function visibleBBoxCenter() {
  let pool = null;
  if (searchKeyword.length > 0 && searchMatches.size > 0) {
    pool = nodes.filter(n => n.visible && searchMatches.has(n.id));
  } else if (_focusMode || _isolateActive) {
    pool = nodes.filter(n => n.visible && !n.dimmed);
  }
  if (!pool || !pool.length) pool = nodes.filter(n => n.visible);
  if (!pool.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const nd of pool) { if (nd.x < x0) x0 = nd.x; if (nd.x > x1) x1 = nd.x; if (nd.y < y0) y0 = nd.y; if (nd.y > y1) y1 = nd.y; }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
// 검색/포커스/경로(격리) 모드에서 비활성(흐려진) 노드는 클릭 대상에서 제외 → 빈 곳처럼 동작
function isNodeInteractable(n) {
  if (searchKeyword.length > 0 && !searchMatches.has(n.id)) return false;
  if ((_focusMode || _isolateActive) && n.dimmed) return false;
  return true;
}
function getNodeAt(sx, sy) { const w=screenToWorld(sx,sy); return nodes.find(n=>n.visible&&isNodeInteractable(n)&&dist(n,w)<=nodeR(n.level)+5)||null; }

function saveFixedPositions() {
  const data = {};
  nodes.filter(n => n.fixed).forEach(n => { data[n.label] = { x: n.x, y: n.y }; });
  snSet('snlog_fixed_pos', JSON.stringify(data), 'pages');
}
function restoreFixedPositions() {
  try {
    const data = JSON.parse(snGet('snlog_fixed_pos', 'pages') || '{}');
    nodes.forEach(n => { if (data[n.label]) { n.fixed=true; n.x=data[n.label].x; n.y=data[n.label].y; n.vx=0; n.vy=0; } });
  } catch(e) {}
  if (typeof restoreSatellites === 'function') restoreSatellites();
}

function placeChildrenAroundParent(parentNode, children, radius) {
  if (!children.length) return;
  const cx = parentNode.x, cy = parentNode.y;
  children.forEach((n, i) => {
    if(n.fixed) return;
    const angle = (2*Math.PI/children.length)*i - Math.PI/2;
    n.x = cx + Math.cos(angle)*radius; n.y = cy + Math.sin(angle)*radius;
    n.vx = 0; n.vy = 0;
  });
}

function revealByLevel(nodeIds, onComplete) {
  const LEVEL_DELAY = 500;
  const RADII = [0, 300, 220, 150, 100];
  const maxLevel = Math.max(...nodes.filter(n => nodeIds.has(n.id)).map(n => n.level), 0);
  for (let lv = 1; lv <= maxLevel; lv++) {
    setTimeout(() => {
      const levelNodes = nodes.filter(n => nodeIds.has(n.id) && n.level === lv);
      const radius = RADII[Math.min(lv, RADII.length - 1)];
      const byParent = new Map();
      levelNodes.forEach(n => {
        const parentEdge = edges.find(e => e.to === n.id && !e.weakLink);
        const parentId = parentEdge ? parentEdge.from : null;
        const parentNode = parentId ? nodeMap[parentId] : null;
        if (!byParent.has(parentId)) byParent.set(parentId, { parent: parentNode, children: [] });
        byParent.get(parentId).children.push(n);
      });
      // 방사형은 부모 주위 원배치(물리 시드용)를 쓰면 트리 좌표가 덮여 마지막 레벨들이 방사형에서 벗어남
      // → 레벨이 열릴 때마다 트리 좌표를 다시 계산해 적용
      const radial = _layoutMode === 'radial';
      if (!radial) byParent.forEach(({ parent, children }) => { if (parent) placeChildrenAroundParent(parent, children, radius); });
      levelNodes.forEach(n => { n.visible = true; });
      nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
      if (radial) applyTreeLayout(); else isStable = false;
    }, lv * LEVEL_DELAY);
  }
  isStable = false;
  return new Promise(resolve => {
    setTimeout(() => { fitGraph(); if(onComplete) onComplete(); resolve(); }, maxLevel * LEVEL_DELAY + 600);
  });
}

function fitGraph(rotate = true) {
  if (nodes.length === 0) return;
  let visibleNodes = nodes.filter(n => n.visible);
  if (visibleNodes.length === 0) return;
  // 검색/포커스/경로/격리 활성 시: 활성(밝은) 노드만 기준으로 맞춤
  let subsetActive = false;
  if (searchKeyword.length > 0 && searchMatches.size > 0) {
    const m = visibleNodes.filter(n => searchMatches.has(n.id));
    if (m.length) { visibleNodes = m; subsetActive = true; }
  } else if (_focusMode || _isolateActive) {
    const a = visibleNodes.filter(n => !n.dimmed);
    if (a.length) { visibleNodes = a; subsetActive = true; }
  }
  const railEl = document.getElementById('activity-rail');
  // 플라이아웃은 오버레이라 그래프를 밀지 않음 — 항상 보이는 레일(56px)만 반영
  const sidebarWidth = railEl ? railEl.offsetWidth : 0;
  const ins = _panelInsets(); // 폰(하단 시트)에선 가로가 아니라 세로를 차지
  const availW = W - sidebarWidth - ins.right - 40, availH = H - 40 - ins.bottom;
  const offsetLeft = sidebarWidth + 20;
  const startRot = _viewRotation;
  let targetRot = startRot;
  // 가장 잘 맞는 회전각 탐색 — 검색/경로/포커스 등 부분집합이 활성일 때만 회전(그 외엔 회전 유지)
  if (rotate && subsetActive) {
    let best = startRot, bestScore = -Infinity;
    for (let deg = 0; deg < 180; deg += 6) {
      const rr = deg * Math.PI / 180, c = Math.cos(rr), s = Math.sin(rr);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of visibleNodes) {
        const dx = n.x - W/2, dy = n.y - H/2;
        const rx = dx*c - dy*s, ry = dx*s + dy*c;
        if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (ry < y0) y0 = ry; if (ry > y1) y1 = ry;
      }
      const gw = (x1 - x0) || 1, gh = (y1 - y0) || 1;
      const score = Math.min(availW / gw, availH / gh);
      if (score > bestScore + 1e-6) { bestScore = score; best = rr; }
    }
    targetRot = best;
    // π 대칭이라 같은 결과 → 시작각에서 가장 가까운 등가각으로(회전 거리 최소화)
    while (targetRot - startRot > Math.PI / 2) targetRot -= Math.PI;
    while (targetRot - startRot < -Math.PI / 2) targetRot += Math.PI;
  }
  // 목표 회전각 기준 타이트 경계 → 스케일 + 중심으로 잡을 월드 점
  const tc = Math.cos(targetRot), tsn = Math.sin(targetRot);
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const n of visibleNodes) {
    const dx = n.x - W/2, dy = n.y - H/2;
    const rx = dx*tc - dy*tsn, ry = dx*tsn + dy*tc;
    if (rx < bx0) bx0 = rx; if (rx > bx1) bx1 = rx; if (ry < by0) by0 = ry; if (ry > by1) by1 = ry;
  }
  const graphW = (bx1 - bx0) || 1, graphH = (by1 - by0) || 1;
  const targetScale = Math.min(availW/graphW, availH/graphH, 1.5) * 0.9;
  const cbx = (bx0 + bx1)/2, cby = (by0 + by1)/2; // 목표 회전 좌표계의 경계 중심
  const itc = Math.cos(-targetRot), itsn = Math.sin(-targetRot);
  const w0x = W/2 + (cbx*itc - cby*itsn), w0y = H/2 + (cbx*itsn + cby*itc); // 항상 가운데 둘 월드 점
  const vcx = offsetLeft + availW/2, vcy = availH/2 + 20;
  if (_fitAnimId) cancelAnimationFrame(_fitAnimId);
  const DURATION = 620, startTime = performance.now();
  const startScale = scale, startPanX = panX, startPanY = panY;
  function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  function animate(now) {
    const t = Math.min((now-startTime)/DURATION, 1), e = easeInOut(t);
    const curRot = startRot + (targetRot-startRot)*e;
    const curScale = startScale + (targetScale-startScale)*e;
    _viewRotation = curRot; scale = curScale;
    // 회전·스케일에 맞춰 w0가 화면 중앙에 오는 팬 — 시작 팬에서 부드럽게 블렌딩
    const c = Math.cos(curRot), s = Math.sin(curRot);
    const dx = w0x - W/2, dy = w0y - H/2;
    const keepPanX = vcx - W/2 - (dx*c - dy*s)*curScale;
    const keepPanY = vcy - H/2 - (dx*s + dy*c)*curScale;
    panX = startPanX + (keepPanX-startPanX)*e;
    panY = startPanY + (keepPanY-startPanY)*e;
    if (t < 1) { _fitAnimId = requestAnimationFrame(animate); }
    else {
      _fitAnimId = null;
      try { localStorage.setItem('snlog_rotation', String(_viewRotation)); } catch (ex) {}
      if (typeof showViewStatus === 'function') showViewStatus();
    }
  }
  _fitAnimId = requestAnimationFrame(animate);
}

// 특정 노드를 보이는 영역 중심으로 부드럽게 이동(줌은 유지). 노드가 움직여도 매 프레임 목표 재계산
function focusViewOnNode(node) {
  if (!node) return;
  if (_fitAnimId) cancelAnimationFrame(_fitAnimId);
  const dur = 440, t0 = performance.now();
  const sx0 = panX, sy0 = panY;
  const ease = t => t < 0.5 ? 2*t*t : -1 + (4-2*t)*t;
  function anim(now) {
    const t = Math.min((now - t0) / dur, 1), e = ease(t);
    const vc = viewportCenter();
    const c = Math.cos(_viewRotation), s = Math.sin(_viewRotation);
    const dx = node.x - W/2, dy = node.y - H/2;
    const rx = dx*c - dy*s, ry = dx*s + dy*c;
    const tx = vc.x - W/2 - rx*scale, ty = vc.y - H/2 - ry*scale;
    panX = sx0 + (tx - sx0) * e;
    panY = sy0 + (ty - sy0) * e;
    if (t < 1) { _fitAnimId = requestAnimationFrame(anim); } else { _fitAnimId = null; }
  }
  _fitAnimId = requestAnimationFrame(anim);
}

// ── 트리/방사형 레이아웃 ────────────────────────────────────────────
// 1차 링크(약한/수동 제외)로 부모→자식 숲(forest) 구성
function _buildForest() {
  const childrenOf = {}; nodes.forEach(n => childrenOf[n.id] = []);
  const hasParent = {};
  edges.forEach(e => {
    if (e.weakLink || e.manualLink) return;
    if (!nodeMap[e.from] || !nodeMap[e.to]) return;
    childrenOf[e.from].push(e.to);
    hasParent[e.to] = true;
  });
  // 뿌리 = 들어오는 1차 링크 없는 노드(페이지·최상위). 레벨 낮은 순으로
  const roots = nodes.filter(n => !hasParent[n.id]).map(n => n.id)
    .sort((a, b) => (nodeMap[a].level || 0) - (nodeMap[b].level || 0));
  return { childrenOf, roots };
}

// 계산된 좌표를 노드에 적용(전체 노드 대상 → reveal/격리와 무관하게 안정적)
function applyTreeLayout() {
  _layoutSig = nodes.length;
  if (!nodes.length) return;
  const { childrenOf, roots } = _buildForest();
  const visited = new Set();
  const pos = {}; // id -> { slot, depth }
  let leafCursor = 0;
  // 후위순회: 리프는 순차 슬롯, 내부노드는 자식 슬롯 평균
  function walk(id, depth) {
    if (visited.has(id)) return null;
    visited.add(id);
    const kids = childrenOf[id].filter(k => !visited.has(k));
    let slot;
    if (!kids.length) { slot = leafCursor++; }
    else {
      const cs = kids.map(k => walk(k, depth + 1)).filter(s => s != null);
      slot = cs.length ? (cs[0] + cs[cs.length - 1]) / 2 : leafCursor++;
    }
    pos[id] = { slot, depth };
    return slot;
  }
  roots.forEach(r => { walk(r, 0); leafCursor += 1; }); // 뿌리 사이 한 칸 띄움
  nodes.forEach(n => { if (!pos[n.id]) pos[n.id] = { slot: leafCursor++, depth: 0 }; }); // 고아 보정
  const totalLeaves = Math.max(leafCursor, 1);

  // 방사형 간격: 반발력↑ → 노드 간 넓게, 중력↑ → 계층(링) 간 촘촘
  const repK = Math.max(0.3, CONFIG.repulsion / 500);   // 기본 500 → 1
  const gravK = Math.max(0.3, CONFIG.gravity / 0.0010); // 기본 0.0010 → 1
  const rStep = 155 * repK / gravK;
  const baseR = roots.length > 1 ? rStep * 0.7 : 0; // 다중 페이지면 뿌리를 안쪽 원에
  nodes.forEach(n => {
    const p = pos[n.id];
    const ang = (p.slot / totalLeaves) * Math.PI * 2 - Math.PI / 2;
    const r = baseR + p.depth * rStep;
    n.x = WORLD_CX + Math.cos(ang) * r;
    n.y = WORLD_CY + Math.sin(ang) * r;
    n.vx = n.vy = 0; n._frozen = true; n._frozenFrames = 0;
  });
  isStable = true;
}

// 클러스터 모드: 보이는 노드의 페이지별로 중력 앵커를 원형 배치
function computePageAnchors() {
  const keys = [...new Set(nodes.filter(n => n.visible).map(n => n.sourcePageId || '_root'))];
  const anchors = {};
  if (keys.length <= 1) { anchors[keys[0] != null ? keys[0] : '_root'] = { x: WORLD_CX, y: WORLD_CY }; return anchors; }
  const R = Math.max(420, keys.length * 220); // 페이지 많을수록 크게
  keys.forEach((k, i) => {
    const ang = (i / keys.length) * Math.PI * 2 - Math.PI / 2;
    anchors[k] = { x: WORLD_CX + Math.cos(ang) * R, y: WORLD_CY + Math.sin(ang) * R };
  });
  return anchors;
}

function setLayoutMode(mode) {
  _layoutMode = (mode === 'radial' || mode === 'cluster') ? mode : 'force';
  try { localStorage.setItem('snlog_layout', _layoutMode); } catch(e) {}
  if (_layoutMode === 'radial') {
    _viewRotation = 0; // 방사형은 똑바로(회전 리셋)
    try { localStorage.setItem('snlog_rotation', '0'); } catch(e) {}
    applyTreeLayout();
  } else {
    // force / cluster: 물리 시뮬 재가동
    nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
    _layoutSig = -1; isStable = false;
    if (_layoutMode === 'cluster') { _pageAnchors = computePageAnchors(); _clusterSig = nodes.length; }
  }
  if (typeof syncLayoutButtons === 'function') syncLayoutButtons();
  if (typeof fitGraph === 'function') fitGraph(false);
}

// ── 링크 해석: [텍스트](노션URL)의 URL 속 ID로 노드 매칭 ──────────────
// 로컬 노드는 노션 ID가 없어 내부 링크 snlog:node:<pageId>:<label> 사용
function _nodeFromLinkUrl(url) {
  if (!url) return null;
  if (url.indexOf('snlog:node:') === 0) {
    const rest = url.slice('snlog:node:'.length), idx = rest.indexOf(':');
    const pid = idx >= 0 ? rest.slice(0, idx) : '', label = idx >= 0 ? decodeURIComponent(rest.slice(idx + 1)) : '';
    return nodes.find(n => String(n.sourcePageId || '') === pid && n.label === label) || nodes.find(n => n.label === label) || null;
  }
  const ids = (url.replace(/-/g, '').match(/[0-9a-f]{32}/gi) || []).map(s => s.toLowerCase());
  if (!ids.length) return null;
  const norm = v => String(v || '').replace(/-/g, '').toLowerCase();
  for (const id of ids) { const n = nodes.find(x => x.notionBlockId && norm(x.notionBlockId) === id); if (n) return n; }
  for (const id of ids) { const n = nodes.find(x => (x.entryNotionId && norm(x.entryNotionId) === id) || (x.sourcePageId && norm(x.sourcePageId) === id)); if (n) return n; }
  return null;
}
// ── 옵시디언식 위키링크 [[노트]] / [[노트#헤딩]] / [[#헤딩]] (별칭 [[..|별칭]]) ──
// 로컬(MD) 노드 전용 — 노션은 [텍스트](url) 그대로. 헤딩도 노드라 #헤딩까지 매칭.
const _WIKI_RE = /\[\[([^\]\n]+?)\]\]/g;
function _isLocalSource(n) { return !!(n && (n.local || /^(md_|local_)/.test(String(n.sourcePageId || '')))); }
function _wnorm(s) { return (s || '').trim().toLowerCase(); }
function _nodeFromWikiRef(ref, src) {
  if (!ref) return null;
  ref = ref.split('|')[0].trim();            // 별칭(| 뒤) 제거
  if (!ref) return null;
  const hash = ref.indexOf('#');
  let notePart = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
  const headPart = (hash >= 0 ? ref.slice(hash + 1) : '').trim();
  notePart = notePart.split('/').pop();      // [[폴더/노트]] → 파일명만 (옵시디언 기본)
  let pageId = null;
  if (!notePart) { pageId = src.sourcePageId; } // [[#헤딩]] → 같은 파일
  else {                                        // [[노트]] / [[노트#헤딩]] → 그 파일 루트를 제목으로
    const root = nodes.find(n => _isLocalSource(n) && n.level === 0 && _wnorm(n.label) === _wnorm(notePart));
    if (!headPart) return root || null;         // 파일 자체 링크 → 루트 노드
    if (root) pageId = root.sourcePageId;
  }
  if (pageId) {
    const hit = nodes.find(n => _isLocalSource(n) && String(n.sourcePageId || '') === String(pageId) && _wnorm(n.label) === _wnorm(headPart));
    if (hit) return hit;
  }
  return nodes.find(n => _isLocalSource(n) && _wnorm(n.label) === _wnorm(headPart)) || null; // 못 찾으면 헤딩 전역 매칭(로컬)
}
// 모든 노드 본문에서 링크를 스캔 → 노드로 해석되는 것만 약한 위키 엣지 재생성. 멱등
const _LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
function resolveWikiLinks() {
  edges = edges.filter(e => !e.wikiLink);
  const seen = new Set();
  const addWiki = (src, target) => {
    if (!target || target.id === src.id) return;
    const key = src.id + '>' + target.id;
    if (seen.has(key)) return; seen.add(key);
    edges.push({ from: src.id, to: target.id, weakLink: true, wikiLink: true });
  };
  nodes.forEach(src => {
    // 블록과 desc 둘 다 훑는다 — 한쪽에만 링크가 들어가도 엣지가 생기게(중복은 seen이 거름)
    const text = [(src.bodyBlocks && src.bodyBlocks.length) ? src.bodyBlocks.map(b => b.text).join('\n') : '', src.desc || ''].join('\n');
    if (!text.trim()) return;
    if (text.indexOf('](') >= 0) {                 // 표준/노션식 [텍스트](url)
      _LINK_RE.lastIndex = 0; let m;
      while ((m = _LINK_RE.exec(text))) addWiki(src, _nodeFromLinkUrl(m[2]));
    }
    if (_isLocalSource(src) && text.indexOf('[[') >= 0) { // 옵시디언식 [[..]] — 로컬 노드만
      _WIKI_RE.lastIndex = 0; let w;
      while ((w = _WIKI_RE.exec(text))) addWiki(src, _nodeFromWikiRef(w[1], src));
    }
  });
}

function buildGraph() {
  _hueIndex = 0;
  const markdown = window._NOTION_MARKDOWN || '';
  if (!markdown || !markdown.trim()) {
    nodes = []; edges = []; Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
    isStable = false; return;
  }
  const title = window._NOTION_TITLE || '노션 페이지';
  const r = parseMarkdown(markdown, title);
  nodes = r.nodes; edges = r.edges; nodeMap = r.nodeMap;
  const root = nodes.find(n => n.level === 0);
  if (root) { root.x = W/2; root.y = H/2; root.vx = 0; root.vy = 0; }
  nodes.forEach(n => { n.visible = n.level === 0; });
  revealByLevel(new Set(nodes.map(n => n.id)), restoreFixedPositions);
  resolveWikiLinks();
}

function mergeGraph(title, markdown, pageId) {
  const result = parseMarkdown(markdown, title);
  const idMap = {};
  const prefix = 'p' + Date.now() + '_' + (_idSeq++) + '_';
  const trackId = pageId || title;
  const existingNodes = nodes.filter(n => n.visible !== false);
  let newRootX, newRootY;
  if (existingNodes.length === 0) { newRootX = W/2; newRootY = H/2; } // 첫 그래프는 겹칠 대상이 없으니 중력 중심에서 생성
  else {
    const minX = Math.min(...existingNodes.map(n => n.x)), maxX = Math.max(...existingNodes.map(n => n.x));
    const minY = Math.min(...existingNodes.map(n => n.y)), maxY = Math.max(...existingNodes.map(n => n.y));
    const centerX = (minX+maxX)/2, centerY = (minY+maxY)/2;
    const graphW = maxX-minX, graphH = maxY-minY;
    const margin = 300;
    const existingCount = nodes.filter(n => n.level === 0 && n.sourcePageId).length;
    const angles = [0, Math.PI, Math.PI/2, -Math.PI/2, Math.PI*0.75, -Math.PI*0.75, Math.PI*0.25, -Math.PI*0.25];
    const angle = angles[existingCount % angles.length];
    const distX = (graphW/2+margin)*Math.abs(Math.cos(angle));
    const distY = (graphH/2+margin)*Math.abs(Math.sin(angle));
    const dist2 = Math.max(distX+distY, 600);
    newRootX = centerX + Math.cos(angle)*dist2; newRootY = centerY + Math.sin(angle)*dist2;
  }
  const newRoot = result.nodes.find(n => n.level === 0);
  const newRootOldId = newRoot ? newRoot.id : null;
  const _isLocalPage = /^(md_|local_)/.test(String(trackId)); // MD·임시 노드는 노션이 아니므로 편집/삭제 가능하게 local 표시
  result.nodes.forEach(n => {
    const oldId = n.id, newId = prefix + oldId;
    idMap[oldId] = newId; n.id = newId; n.sourcePageId = trackId;
    if (_isLocalPage) n.local = true;
    n.visible = false; n.x = newRootX; n.y = newRootY; n.vx = 0; n.vy = 0;
    nodes.push(n); nodeMap[newId] = n;
  });
  const newRootNewId = newRootOldId ? idMap[newRootOldId] : null;
  const newRootNode = newRootNewId ? nodeMap[newRootNewId] : null;
  if (newRootNode) newRootNode.visible = true;
  result.edges.forEach(e => {
    const newFrom = idMap[e.from], newTo = idMap[e.to];
    if (newFrom && newTo && nodeMap[newFrom] && nodeMap[newTo]) edges.push({ from: newFrom, to: newTo });
  });
  const firstRoot = nodes.find(n => n.level === 0 && !n.sourcePageId);
  if (firstRoot && newRootNewId && firstRoot.id !== newRootNewId) {
    edges.push({ from: firstRoot.id, to: newRootNewId, weakLink: true });
  }
  const newNodeIds = new Set(Object.values(idMap));
  const ret = revealByLevel(newNodeIds, restoreFixedPositions);
  resolveWikiLinks();
  return ret;
}

// 증분 동기화 — 기존 노드는 위치/id/탭참조 유지하고 내용만 갱신, 추가/삭제만 반영
// 매칭 키: 루트=root, 헤딩=blk:<notionBlockId>, 엔트리=entry:<entryNotionId>, 그 외=lbl:<level>:<label>
// 반환: 삭제된 노드 id Set (호출측에서 열린 탭 정리용)
function syncPageIncremental(title, markdown, pageId) {
  const oldNodes = nodes.filter(n => n.sourcePageId === pageId);
  if (!oldNodes.length) { mergeGraph(title, markdown, pageId); return new Set(); }

  const result = parseMarkdown(markdown, title);
  const uniq = 'sp' + Date.now() + '_' + (_idSeq++) + '_';
  const keyOf = n => n.level === 0 ? 'root'
    : n.notionBlockId ? 'blk:' + n.notionBlockId
    : n.entryNotionId ? 'entry:' + n.entryNotionId
    : 'lbl:' + n.level + ':' + n.label;

  // DB 엔트리 하위(엔트리 노드의 자식들)는 headings에 없고 _loadEntriesBackground로 따로 관리 →
  // 동기화 범위에서 제외해서 삭제/갱신 대상으로 보지 않는다 (엔트리 노드 자체는 범위에 포함)
  const entryDescendants = new Set();
  {
    const q = oldNodes.filter(n => n.entryNotionId).map(n => n.id);
    const seen = new Set(q);
    while (q.length) {
      const id = q.shift();
      edges.forEach(e => { if (e.from === id && !e.weakLink && !seen.has(e.to)) { seen.add(e.to); entryDescendants.add(e.to); q.push(e.to); } });
    }
  }
  const scopeOld = oldNodes.filter(n => !entryDescendants.has(n.id));
  const scopeOldIds = new Set(scopeOld.map(n => n.id));

  const oldByKey = new Map();
  scopeOld.forEach(n => { const k = keyOf(n); if (!oldByKey.has(k)) oldByKey.set(k, n); });
  const pageRootPos = oldByKey.get('root') || scopeOld[0] || oldNodes[0];

  result.nodes.forEach(tn => { tn._tmp = tn.id; });
  const tempParentOf = {};
  result.edges.forEach(e => { if (!e.weakLink) tempParentOf[e.to] = e.from; });

  // 내용만 덮어쓸 필드 (위치/속도/고정/표시 상태는 보존)
  const COPY = ['label', 'labelMd', 'desc', 'date', 'color', '_rgb', 'level', 'headingDepth', 'bodyBlocks',
    'notionToggle', 'notionBlockId', 'notionParentId', 'entryNotionId', 'isDbNode', 'isChildPage', 'titleHeading'];
  const idMap = {};
  const seenOld = new Set();

  result.nodes.forEach(tn => {
    const k = keyOf(tn);
    const old = oldByKey.get(k);
    if (old && !seenOld.has(old.id)) {
      COPY.forEach(f => { if (f in tn) old[f] = tn[f]; else delete old[f]; });
      old.sourcePageId = pageId;
      idMap[tn._tmp] = old.id;
      seenOld.add(old.id);
    } else {
      const ptmp = tempParentOf[tn._tmp];
      const parentFinal = ptmp != null ? nodeMap[idMap[ptmp]] : null;
      const px = parentFinal ? parentFinal.x : pageRootPos.x;
      const py = parentFinal ? parentFinal.y : pageRootPos.y;
      const newId = uniq + tn._tmp;
      idMap[tn._tmp] = newId;
      tn.id = newId; tn.sourcePageId = pageId;
      tn.x = px + (Math.random() - 0.5) * 80; tn.y = py + (Math.random() - 0.5) * 80;
      tn.vx = 0; tn.vy = 0; tn.visible = true; tn.fixed = false;
      nodes.push(tn); nodeMap[newId] = tn;
    }
  });

  // 삭제된 노드 (이번 마크다운에 없는 기존 헤딩 노드 — 엔트리 하위는 제외됨)
  const removedIds = new Set(scopeOld.filter(n => !seenOld.has(n.id)).map(n => n.id));

  // 헤딩 구조 내부 엣지만 제거(양끝 모두 범위 안)하고 새 구조로 재구성
  // — 엔트리 노드→하위 엣지는 한쪽 끝만 범위 안이라 보존됨
  edges = edges.filter(e => !(scopeOldIds.has(e.from) && scopeOldIds.has(e.to)));
  result.edges.forEach(e => {
    if (e.weakLink) return;
    const f = idMap[e.from], t = idMap[e.to];
    if (f && t && nodeMap[f] && nodeMap[t]) edges.push({ from: f, to: t });
  });
  // 첫 루트 ↔ 페이지 루트 약한 링크 (없으면 복원)
  const firstRoot = nodes.find(n => n.level === 0 && !n.sourcePageId);
  const pageRootNode = oldByKey.get('root');
  if (firstRoot && pageRootNode && firstRoot.id !== pageRootNode.id
      && !edges.some(e => e.weakLink && e.from === firstRoot.id && e.to === pageRootNode.id)) {
    edges.push({ from: firstRoot.id, to: pageRootNode.id, weakLink: true });
  }

  if (removedIds.size) {
    nodes = nodes.filter(n => !removedIds.has(n.id));
    removedIds.forEach(id => delete nodeMap[id]);
    edges = edges.filter(e => !removedIds.has(e.from) && !removedIds.has(e.to));
  }
  result.nodes.forEach(tn => { delete tn._tmp; });
  isStable = false;
  return removedIds;
}
