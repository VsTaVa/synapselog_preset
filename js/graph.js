// ── 공유 전역 상태 (ui.js에서 canvas/ctx/W/H 초기화) ────────────────
let canvas, ctx, W, H, DPR = 1;
let WORLD_CX = 0, WORLD_CY = 0;
let scale = 0.85, panX = 0, panY = 0;
let nodes = [], edges = [], nodeMap = {};
let drag = null, hoveredNode = null;
let isPanning = false, panStartX = 0, panStartY = 0, panStartOffsetX = 0, panStartOffsetY = 0;
let isStable = false;
let CONFIG = { repulsion: 500, gravity: 0.0010, linkDistance: 60, nodeSize: 1.0, linkWidth: 1.5, linkTension: 0.005 };
let searchKeyword = '', searchMatches = new Set();
let searchDirect = new Set(); // 키워드 직접 매칭 노드(글로우 대상). searchMatches는 조상 경로 포함
let _showLabels = true;
let _labelScale = (() => { try { const v = parseFloat(localStorage.getItem('snlog_label_scale')); return (v >= 0.5 && v <= 2.5) ? v : 1; } catch(e) { return 1; } })();
// 뷰 회전(라디안) — 노드 위치는 그대로, 보는 각도만 회전. 라벨은 화면좌표로 따로 그려 항상 수평
let _viewRotation = (() => { try { const v = parseFloat(localStorage.getItem('snlog_rotation')); return isFinite(v) ? v : 0; } catch(e) { return 0; } })();

// 그래프 배치 모드: 'force'(힘기반·기본) | 'radial'(방사형 트리) | 'tree'(계층형 트리)
let _layoutMode = (() => { try { const v = localStorage.getItem('snlog_layout'); return (v === 'radial' || v === 'tree') ? v : 'force'; } catch(e) { return 'force'; } })();
let _layoutSig = -1; // 마지막 트리 배치 시 노드 수(변하면 재배치)

let _focusMode = false, _focusNodeId = null;
let _connectMode = false, _connectFirstNode = null;
let _fitAnimId = null;
let _multiSelected = [], _isolateActive = false, _multiSelectMode = false;
let _pathConnectors = [];
let _satelliteRemovedEdges = [];

// 위성 모드 아이콘 (노드 위에 띄움) — 점선 링 대체
const SATELLITE_ICON_PATH = "M 204.00 657.89 C186.13,655.81 172.71,651.84 164.70,646.29 C160.10,643.10 158.92,640.97 155.98,630.50 C153.32,621.02 153.99,616.68 159.39,608.50 C163.43,602.37 175.10,590.90 184.50,583.82 C193.31,577.18 217.07,562.00 218.65,562.00 C219.31,562.00 220.14,563.35 220.50,565.01 C220.86,566.66 222.72,571.89 224.63,576.62 C226.54,581.36 227.97,585.34 227.80,585.48 C227.64,585.62 223.68,588.11 219.00,591.01 C207.24,598.30 193.60,608.71 186.71,615.65 C177.78,624.63 179.06,627.36 193.63,630.42 C215.53,635.03 249.33,635.04 295.50,630.46 C340.50,625.99 401.93,615.25 455.50,602.49 C493.68,593.40 585.78,567.63 615.97,557.60 C621.74,555.68 626.52,554.20 626.61,554.31 C626.69,554.41 628.23,557.42 630.01,561.00 C631.80,564.58 634.60,569.44 636.23,571.82 C637.86,574.20 639.04,576.28 638.85,576.45 C638.56,576.70 620.53,582.69 602.48,588.52 C595.46,590.79 506.26,615.66 486.50,620.86 C453.43,629.56 423.34,636.04 374.50,644.96 C347.24,649.94 308.15,655.06 279.00,657.46 C261.22,658.93 215.12,659.19 204.00,657.89 ZM 710.93 657.75 C710.88,657.06 710.69,655.60 710.48,654.50 C710.28,653.40 707.83,636.75 705.04,617.50 C698.66,573.59 698.10,570.13 696.80,566.74 C695.59,563.55 692.55,562.46 688.84,563.87 C686.18,564.88 666.51,576.79 651.50,586.47 C646.82,589.49 643.00,591.57 643.00,591.10 C643.00,590.63 648.62,580.90 655.50,569.48 C663.22,556.65 668.00,547.68 668.00,546.03 C668.00,543.32 665.03,539.84 661.74,538.68 C660.77,538.33 654.24,537.13 647.24,536.01 C640.23,534.88 630.67,533.34 626.00,532.59 C621.33,531.83 607.49,529.73 595.25,527.92 C583.01,526.11 573.00,524.33 573.00,523.97 C573.00,523.24 578.02,522.34 606.50,517.99 C641.13,512.69 660.94,509.08 663.99,507.50 C668.28,505.29 669.35,502.75 667.66,498.77 C666.90,496.97 661.04,486.98 654.64,476.57 C643.25,458.06 641.72,455.11 644.25,456.63 C644.94,457.05 651.99,461.40 659.91,466.31 C677.51,477.21 685.33,481.00 690.26,481.00 C695.51,481.00 697.28,477.69 699.44,463.74 C700.40,457.56 701.39,451.15 701.65,449.50 C701.91,447.85 704.10,432.83 706.51,416.13 C710.53,388.35 711.37,383.86 712.32,385.08 C712.50,385.31 715.44,405.29 718.85,429.48 C722.87,457.95 725.67,474.71 726.78,476.98 C728.28,480.06 729.02,480.54 732.64,480.80 C736.00,481.05 738.55,480.18 746.14,476.21 C751.29,473.52 759.78,468.61 765.00,465.30 C770.22,462.00 775.99,458.53 777.80,457.59 L 781.11 455.89 L 779.41 459.20 C778.48,461.01 772.60,470.72 766.36,480.77 C754.15,500.41 753.02,503.65 757.36,506.50 C761.04,508.91 772.49,511.06 826.50,519.47 C847.82,522.79 850.14,523.25 849.34,524.02 C848.88,524.47 838.83,526.26 827.00,528.01 C783.79,534.40 762.47,538.09 759.02,539.78 C752.54,542.95 753.21,545.33 766.88,567.80 C773.48,578.66 779.20,588.37 779.59,589.37 C780.26,591.13 780.15,591.13 776.99,589.50 C775.18,588.56 770.50,585.73 766.60,583.22 C749.03,571.92 733.57,563.00 731.53,563.00 C726.18,563.00 726.22,562.82 717.87,621.75 C714.96,642.24 712.23,659.00 711.79,659.00 C711.36,659.00 710.97,658.44 710.93,657.75 ZM 799.09 504.17 C798.46,501.05 796.91,495.45 795.64,491.73 C794.04,487.02 793.66,484.71 794.42,484.14 C795.01,483.68 799.78,480.93 805.00,478.03 C821.79,468.70 839.57,456.31 848.86,447.47 C857.44,439.31 857.82,438.77 856.87,436.07 C856.06,433.72 854.90,432.96 850.19,431.65 C840.52,428.98 831.17,427.83 813.56,427.15 L 796.61 426.50 L 794.78 416.50 C793.77,411.00 792.85,405.38 792.72,404.00 L 792.50 401.50 L 809.00 401.73 C847.01,402.26 871.35,408.45 878.55,419.43 C880.53,422.46 884.00,435.09 884.00,439.29 C884.00,445.42 879.24,452.92 868.58,463.58 C855.10,477.06 834.74,491.13 806.86,506.24 L 800.23 509.84 L 799.09 504.17 Z";
const SATELLITE_ICON = (typeof Path2D !== 'undefined') ? new Path2D(SATELLITE_ICON_PATH) : null;
// 아이콘 바운딩박스 중심·크기 (viewBox 1024) — 위치 보정용
const SAT_BBOX = { cx: 519, cy: 521, w: 731, h: 275 };
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
    const label = cleanLabel(rawLabel);
    if (!label || label.length < 1) return null;
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
      if (parentColor) color = hslColor(extractHue(parentColor), 90, 48);
    } else if (level === 4) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), Math.max(getSaturation(parentColor), 88), 41);
    } else if (level === 5) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), Math.max(getSaturation(parentColor), 88), 38);
    }
    const id = 'n' + (nid++);
    const n = {
      id, label, desc: cleanDesc(desc), date,
      x: W/2 + (Math.random()-0.5)*60, y: H/2 + (Math.random()-0.5)*60,
      vx: 0, vy: 0, level, fixed: false, color,
      _rgb: hexToRgb(level === 0 ? '#ffffff' : (color || '#74b9ff'))
    };
    nodes.push(n); nodeMap[id] = n;
    if (parentId) edges.push({ from: parentId, to: id });
    return id;
  }

  const rootId = addNode(rootTitle || '자기관리: 내면', '', null, '', 0);
  const currentParents = { 0: rootId, 1: null, 2: null, 3: null, 4: null, 5: null };
  const lines = text.split('\n');
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
      let lbl = headerMatch[2].trim().replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');
      let nDate = '';
      const inlineDateMatch = lbl.match(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/);
      if (inlineDateMatch) { nDate = inlineDateMatch[1]; lbl = lbl.replace(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/, ''); }
      let parentId = null;
      for (let d = depth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }
      if (!parentId) parentId = rootId;
      let descLines = [], bodyBlocks = [], curBlk = null, nextIdx = i + 1;
      const flushBlk = () => { if (curBlk) { bodyBlocks.push({ id: curBlk.id, text: curBlk.lines.join('\n') }); curBlk = null; } };
      while (nextIdx < lines.length) {
        const rawLine = lines[nextIdx].replace(/\s+$/, '');
        let nextLine = rawLine.trim();
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
        if (dateOnlyMatch) { nDate = nDate || dateOnlyMatch[1]; nextIdx++; continue; }
        if (/^\*\*[^*]{3,60}\*\*$/.test(nextLine) && descLines.length > 0) break;
        if (descLines.join('\n').length > 3000) { nextIdx++; continue; }
        descLines.push(rawLine);
        if (curBlk) curBlk.lines.push(bodyBlockText(rawLine)); // 한 블록의 모든 줄(소프트 줄바꿈 포함) 수집
        nextIdx++;
      }
      flushBlk();
      const curId = addNode(lbl, descLines.join('\n').substring(0, 5000), parentId, nDate, depth);
      if (curId) {
        nodeMap[curId].headingDepth = rawDepth;
        if (bodyBlocks.length) nodeMap[curId].bodyBlocks = bodyBlocks;
        if (pendingEntryId) { nodeMap[curId].entryNotionId = pendingEntryId; pendingEntryId = null; }
        if (pendingBlockId) { nodeMap[curId].notionBlockId = pendingBlockId; nodeMap[curId].notionParentId = pendingParentId; pendingBlockId = null; pendingParentId = null; }
        if (pendingToggle) { nodeMap[curId].notionToggle = true; pendingToggle = false; }
        if (pendingIsDbNode) { nodeMap[curId].isDbNode = true; pendingIsDbNode = false; }
        if (pendingIsChildPage) { nodeMap[curId].isChildPage = true; pendingIsChildPage = false; }
        currentParents[depth] = curId;
        for (let d = depth + 1; d <= 5; d++) currentParents[d] = null;
      }
      if (nextIdx > i + 1) i = nextIdx - 1;
    }
  }
  return { nodes, edges, nodeMap };
}

// ── 물리 시뮬레이션 ─────────────────────────────────────────────────

function simulate() {
  // 트리/방사형 배치: 물리 끄고 계산 좌표 유지. 노드 수 바뀌면(페이지 로드/삭제 등) 재배치
  if (_layoutMode !== 'force') {
    if (nodes.length !== _layoutSig) applyTreeLayout();
    return;
  }
  if (isStable && !drag) return;
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
    nodes.forEach(m => {
      if(m === n || !m.visible) return;
      const dx = n.x-m.x, dy = n.y-m.y, d = Math.max(dist(n,m), 1);
      if(d < 400) { const f = repulsion/(d*d); fx += dx/d*f; fy += dy/d*f; }
    });
    edges.forEach(e => {
      if(e.from !== n.id && e.to !== n.id) return;
      const other = nodeMap[e.from===n.id?e.to:e.from];
      if(!other||!other.visible) return;
      if(other.fixed && e.from === n.id) return;
      const dx = other.x-n.x, dy = other.y-n.y, d = Math.max(dist(n,other), 1);
      let natural = CONFIG.linkDistance, strength = CONFIG.linkTension;
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

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0c0d12'; ctx.fillRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2+panX, H/2+panY);
  ctx.scale(scale, scale);
  if (_viewRotation) ctx.rotate(_viewRotation);
  ctx.translate(-W/2, -H/2);
  const labelQueue = [];
  const hasSearch = searchKeyword.length > 0;
  const childCountMap = new Map(), manualLinkedSet = new Set();
  edges.forEach(e => {
    if (!e.weakLink && !e.manualLink) childCountMap.set(e.from, (childCountMap.get(e.from) || 0) + 1);
    if (e.manualLink) { manualLinkedSet.add(e.from); manualLinkedSet.add(e.to); }
  });

  edges.forEach(e => {
    const na=nodeMap[e.from], nb=nodeMap[e.to];
    if(!na||!nb||!na.visible||!nb.visible) return;
    const isHov = hoveredNode&&(hoveredNode.id===e.from||hoveredNode.id===e.to);
    const bothMatch = hasSearch&&searchMatches.has(e.from)&&searchMatches.has(e.to);
    const eitherMatch = hasSearch&&(searchMatches.has(e.from)||searchMatches.has(e.to));
    if(e.manualLink) {
      if(hasSearch && !bothMatch) return;
      if((_focusMode||_isolateActive) && na.dimmed && nb.dimmed) return;
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
      const eRgb = _colorScheme === 'depth' ? nodeRgb(nb) : na._rgb;
      if(bothMatch) { ctx.strokeStyle=rgbStr(eRgb,focusDim?0.15:0.9); ctx.lineWidth=(focusDim?0.6:1.6)/scale; ctx.setLineDash([5,3]); }
      else if(eitherMatch) { ctx.strokeStyle=rgbStr(eRgb,focusDim?0.06:0.35); ctx.lineWidth=(focusDim?0.4:0.8)/scale; ctx.setLineDash([4,5]); }
      else { ctx.strokeStyle=rgbStr(eRgb,0.05); ctx.lineWidth=0.5/scale; ctx.setLineDash([3,7]); }
    } else {
      if((_focusMode||_isolateActive) && na.dimmed && nb.dimmed) return;
      const isDimEdge = (_focusMode||_isolateActive) && (na.dimmed || nb.dimmed);
      const alpha=isDimEdge?0.08:(isHov?0.85:0.55), width=isDimEdge?0.5:(isHov?2.2:0.8);
      const eRgb = _colorScheme === 'depth' ? nodeRgb(nb) : na._rgb;
      ctx.strokeStyle=rgbStr(eRgb,alpha); ctx.lineWidth=width*CONFIG.linkWidth/scale; ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke();
    ctx.setLineDash([]);
  });

  if(_isolateActive && _pathConnectors.length) {
    _pathConnectors.forEach(c => {
      const a = nodeMap[c.from], b = nodeMap[c.to];
      if(!a || !b || !a.visible || !b.visible) return;
      ctx.strokeStyle = 'rgba(237,112,0,0.9)';
      ctx.lineWidth = 1.8*CONFIG.linkWidth/scale; ctx.setLineDash([8,4]);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    });
  }

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
    const isDirectMatch=searchDirect.has(n.id);
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
    if(isDirectMatch) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+18,0,Math.PI*2);
      const g1=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+18);
      g1.addColorStop(0,'rgba(255,255,255,0.25)'); g1.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=g1; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x,n.y,r+8,0,Math.PI*2);
      const g2=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+8);
      g2.addColorStop(0,'rgba(255,255,255,0.4)'); g2.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=g2; ctx.fill();
    } else if(isHov) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+12,0,Math.PI*2);
      const g=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+12);
      g.addColorStop(0,rgbStr(ndRgb,0.3)); g.addColorStop(1,rgbStr(ndRgb,0));
      ctx.fillStyle=g; ctx.fill();
    }
    if(n.level===0) drawStar8(ctx, n.x, n.y, r);
    else if(n.isDbNode) drawStar4(ctx, n.x, n.y, r);
    else if(n.isChildPage || n.entryNotionId) drawStarX(ctx, n.x, n.y, r);
    else { ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2); }
    if(isMatch) { ctx.fillStyle='#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else if(n.level===0) { ctx.fillStyle='#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else {
      // 깊이별 명도는 HSL 단계에서 처리 — 여기선 배경 혼합 없이 원색 그대로(쨍하게)
      ctx.fillStyle=isDim?rgbStr(ndRgb,0.15):rgbStr(ndRgb,1);
      ctx.strokeStyle=isDim?rgbStr(ndRgb,0.06):rgbStr(ndRgb,1);
      ctx.lineWidth=isHov?2/scale:1/scale; ctx.fill(); ctx.stroke();
    }
    if(n.fixed) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+3.5,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=1/scale;
      ctx.setLineDash([2.5,2.5]); ctx.stroke(); ctx.setLineDash([]);
    }
    if(n._satelliteRoot && SATELLITE_ICON) {
      // 위성 모드 아이콘 — 노드 중앙에 겹쳐 표시(궤도처럼)
      const iconW = r * 4.6;
      const s = iconW / SAT_BBOX.w;
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(s, s);
      ctx.translate(-SAT_BBOX.cx, -SAT_BBOX.cy);
      ctx.fillStyle = isDim ? 'rgba(238,119,0,0.18)' : 'rgba(238,119,0,0.95)';
      ctx.fill(SATELLITE_ICON);
      ctx.restore();
    }
    if(typeof isBookmarked === 'function' && isBookmarked(n)) {
      // 북마크: 주황색 허브 글로우 (노드 연결 선택과 같은 방식, 실선 없이)
      ctx.beginPath(); ctx.arc(n.x, n.y, r+16, 0, Math.PI*2);
      const gBm = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+16);
      gBm.addColorStop(0, 'rgba(237,112,0,0.5)'); gBm.addColorStop(1, 'rgba(237,112,0,0)');
      ctx.fillStyle = gBm; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, r+7, 0, Math.PI*2);
      const gBm2 = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+7);
      gBm2.addColorStop(0, 'rgba(237,112,0,0.7)'); gBm2.addColorStop(1, 'rgba(237,112,0,0)');
      ctx.fillStyle = gBm2; ctx.fill();
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
      const alreadyLinked = edges.some(e => e.manualLink && ((e.from === _connectFirstNode.id && e.to === n.id) || (e.from === n.id && e.to === _connectFirstNode.id)));
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
      ctx.beginPath(); ctx.arc(n.x, n.y, r+8, 0, Math.PI*2);
      ctx.strokeStyle = '#ed7000'; ctx.lineWidth = 2/scale; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      const order = _multiSelected.indexOf(n) + 1;
      if (order > 0) {
        ctx.beginPath(); ctx.arc(n.x+r+6, n.y-r-6, 7/scale, 0, Math.PI*2);
        ctx.fillStyle = '#ed7000'; ctx.fill();
        ctx.fillStyle = '#15110a'; ctx.font = `bold ${10/scale}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(order, n.x+r+6, n.y-r-6);
        ctx.textAlign='start'; ctx.textBaseline='alphabetic';
      }
    }
    ctx.restore();
    if(_showLabels) labelQueue.push({ n, r, isMatch, isDim });
  });
  ctx.restore();

  // 라벨은 화면좌표(수평·노드 아래)로 따로 그림 — 뷰 회전과 무관하게 항상 똑바로
  if (_showLabels && labelQueue.length) {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    labelQueue.forEach(({ n, r, isMatch, isDim }) => {
      const sp = worldToScreen(n.x, n.y);
      const sr = r * scale;
      let lbl = n.label ? n.label.replace(/[\n]/g, ' ') : '';
      const maxLen = _layoutMode === 'tree' ? 24 : 14;
      if (n.level >= 2 && lbl.length > maxLen) lbl = lbl.substring(0, maxLen - 1) + '…';
      let fontSize = 10;
      if (n.level === 0 || n.level === 1) fontSize = 12;
      else if (n.level === 2) fontSize = 11;
      fontSize = fontSize * _labelScale * scale;
      const lblFont = (n.level <= 1) ? `bold ${fontSize}px 'Noto Sans KR',sans-serif` : `500 ${fontSize}px 'Noto Sans KR',sans-serif`;
      ctx.font = lblFont;
      ctx.fillStyle = isMatch ? '#ffffff' : `rgba(215,220,230,${isDim ? 0.12 : 0.85})`;
      if (_layoutMode === 'tree') {
        // 계층형: 라벨을 노드 오른쪽 세로 중앙에 → 행마다 한 줄, 세로 겹침 없음
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl, sp.x + sr + 5 * scale, sp.y);
      } else {
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(lbl, sp.x, sp.y + sr + 5 * scale);
      }
    });
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
      byParent.forEach(({ parent, children }) => { if (parent) placeChildrenAroundParent(parent, children, radius); });
      levelNodes.forEach(n => { n.visible = true; });
      nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
      isStable = false;
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
  const railEl = document.getElementById('activity-rail'), dpEl = document.getElementById('detail-panel');
  // 플라이아웃은 오버레이라 그래프를 밀지 않음 — 항상 보이는 레일(56px)만 반영
  const sidebarWidth = railEl ? railEl.offsetWidth : 0;
  const detailWidth = dpEl.classList.contains('open') ? dpEl.offsetWidth + 20 : 0;
  const availW = W - sidebarWidth - detailWidth - 40, availH = H - 40;
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
  const targetScale = Math.min(availW/graphW, availH/graphH, 1.5) * 0.82;
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

  const colGap = 260, rowGap = 46, rStep = 155; // tree: colGap=깊이 열 간격, rowGap=리프 행 간격
  const baseR = roots.length > 1 ? rStep * 0.7 : 0; // 다중 페이지면 뿌리를 안쪽 원에
  nodes.forEach(n => {
    const p = pos[n.id];
    if (_layoutMode === 'radial') {
      const ang = (p.slot / totalLeaves) * Math.PI * 2 - Math.PI / 2;
      const r = baseR + p.depth * rStep;
      n.x = WORLD_CX + Math.cos(ang) * r;
      n.y = WORLD_CY + Math.sin(ang) * r;
    } else {
      // 계층형: 왼→오(깊이=x), 리프=y → 세로로 길게, 리프마다 한 줄
      n.x = WORLD_CX + p.depth * colGap;
      n.y = WORLD_CY + (p.slot - totalLeaves / 2) * rowGap;
    }
    n.vx = n.vy = 0; n._frozen = true; n._frozenFrames = 0;
  });
  isStable = true;
}

function setLayoutMode(mode) {
  _layoutMode = (mode === 'radial' || mode === 'tree') ? mode : 'force';
  try { localStorage.setItem('snlog_layout', _layoutMode); } catch(e) {}
  if (_layoutMode === 'force') {
    nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
    _layoutSig = -1; isStable = false;
  } else {
    _viewRotation = 0; // 트리는 똑바로(회전 리셋)
    try { localStorage.setItem('snlog_rotation', '0'); } catch(e) {}
    applyTreeLayout();
  }
  if (typeof syncLayoutButtons === 'function') syncLayoutButtons();
  if (typeof fitGraph === 'function') fitGraph(false);
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
}

function mergeGraph(title, markdown, pageId) {
  const result = parseMarkdown(markdown, title);
  const idMap = {};
  const prefix = 'p' + Date.now() + '_';
  const trackId = pageId || title;
  const existingNodes = nodes.filter(n => n.visible !== false);
  let newRootX, newRootY;
  if (existingNodes.length === 0) { newRootX = W/2 + 500; newRootY = H/2; }
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
  result.nodes.forEach(n => {
    const oldId = n.id, newId = prefix + oldId;
    idMap[oldId] = newId; n.id = newId; n.sourcePageId = trackId;
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
  return revealByLevel(newNodeIds, restoreFixedPositions);
}

// 증분 동기화 — 기존 노드는 위치/id/탭참조 유지하고 내용만 갱신, 추가/삭제만 반영
// 매칭 키: 루트=root, 헤딩=blk:<notionBlockId>, 엔트리=entry:<entryNotionId>, 그 외=lbl:<level>:<label>
// 반환: 삭제된 노드 id Set (호출측에서 열린 탭 정리용)
function syncPageIncremental(title, markdown, pageId) {
  const oldNodes = nodes.filter(n => n.sourcePageId === pageId);
  if (!oldNodes.length) { mergeGraph(title, markdown, pageId); return new Set(); }

  const result = parseMarkdown(markdown, title);
  const uniq = 'sp' + Date.now() + '_';
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
  const COPY = ['label', 'desc', 'date', 'color', '_rgb', 'level', 'headingDepth', 'bodyBlocks',
    'notionToggle', 'notionBlockId', 'notionParentId', 'entryNotionId', 'isDbNode', 'isChildPage'];
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
