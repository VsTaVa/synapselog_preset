// ── 키 난독화 : 로컬/세션 저장 시 평문 노출 방지 ──────────────────────
// 주의: 클라이언트 전용 난독화라 완벽한 암호화가 아님(복호 키가 코드에 존재).
// F12 등으로 평문이 그대로 보이는 것만 막는 용도.
const _KENC_SALT = 'sYnApSeLoG_kx_2026';
function _encKey(s) {
  if (!s) return s || '';
  try {
    let o = '';
    for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ _KENC_SALT.charCodeAt(i % _KENC_SALT.length));
    return 'enc:' + btoa(o);
  } catch (e) { return s; }
}
function _decKey(s) {
  if (!s || s.indexOf('enc:') !== 0) return s || ''; // 접두어 없으면 구버전 평문 → 그대로
  try {
    const raw = atob(s.slice(4));
    let o = '';
    for (let i = 0; i < raw.length; i++) o += String.fromCharCode(raw.charCodeAt(i) ^ _KENC_SALT.charCodeAt(i % _KENC_SALT.length));
    return o;
  } catch (e) { return ''; }
}
// ── 색상/수치 헬퍼 ──────────────────────────────────────────────────

let _hueIndex = 0;
const _labelHueMap = {};

function getBaseHue(label) {
  if (_labelHueMap[label] === undefined) {
    _labelHueMap[label] = (_hueIndex * 137.508) % 360;
    _hueIndex++;
  }
  return _labelHueMap[label];
}

function nodeR(level) {
  const base = [14, 10, 7.2, 5.2, 3.8, 2.8][Math.min(level, 5)];
  return base * (typeof CONFIG !== 'undefined' ? CONFIG.nodeSize : 1);
}

function drawStar8(ctx, cx, cy, r) {
  const outerLong = r * 2.0, outerShort = r * 1.3, inner = r * 0.52, round = r * 0.28;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 2;
    const nextAngle = angle + Math.PI / 4;
    const outer = (i % 2 === 0) ? outerLong : outerShort;
    const nextOuter = (i % 2 === 0) ? outerShort : outerLong;
    const ox = cx + Math.cos(angle) * outer, oy = cy + Math.sin(angle) * outer;
    const ia = angle + Math.PI / 8;
    const ix = cx + Math.cos(ia) * inner, iy = cy + Math.sin(ia) * inner;
    const nox = cx + Math.cos(nextAngle) * nextOuter, noy = cy + Math.sin(nextAngle) * nextOuter;
    const d1x = ix - ox, d1y = iy - oy, l1 = Math.sqrt(d1x*d1x + d1y*d1y);
    const p1x = ix - (d1x/l1)*round, p1y = iy - (d1y/l1)*round;
    const d2x = nox - ix, d2y = noy - iy, l2 = Math.sqrt(d2x*d2x + d2y*d2y);
    const p2x = ix + (d2x/l2)*round, p2y = iy + (d2y/l2)*round;
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(ix, iy, p2x, p2y);
  }
  ctx.closePath();
}

// DB 중간 노드 — 4방향 십자별 (대각선 없음)
function drawStar4(ctx, cx, cy, r) {
  const outer = r * 1.35, inner = r * 0.38, round = r * 0.18;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI / 2) - Math.PI / 2;
    const nextAngle = angle + Math.PI / 2;
    const ox = cx + Math.cos(angle) * outer, oy = cy + Math.sin(angle) * outer;
    const ia = angle + Math.PI / 4;
    const ix = cx + Math.cos(ia) * inner, iy = cy + Math.sin(ia) * inner;
    const nox = cx + Math.cos(nextAngle) * outer, noy = cy + Math.sin(nextAngle) * outer;
    const d1x = ix - ox, d1y = iy - oy, l1 = Math.sqrt(d1x*d1x + d1y*d1y);
    const p1x = ix - (d1x/l1)*round, p1y = iy - (d1y/l1)*round;
    const d2x = nox - ix, d2y = noy - iy, l2 = Math.sqrt(d2x*d2x + d2y*d2y);
    const p2x = ix + (d2x/l2)*round, p2y = iy + (d2y/l2)*round;
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(ix, iy, p2x, p2y);
  }
  ctx.closePath();
}

// 하위페이지 노드 — 4방향 X별 (45° 회전)
function drawStarX(ctx, cx, cy, r) {
  const outer = r * 1.2, inner = r * 0.38, round = r * 0.18;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI / 2) - Math.PI / 4;
    const nextAngle = angle + Math.PI / 2;
    const ox = cx + Math.cos(angle) * outer, oy = cy + Math.sin(angle) * outer;
    const ia = angle + Math.PI / 4;
    const ix = cx + Math.cos(ia) * inner, iy = cy + Math.sin(ia) * inner;
    const nox = cx + Math.cos(nextAngle) * outer, noy = cy + Math.sin(nextAngle) * outer;
    const d1x = ix - ox, d1y = iy - oy, l1 = Math.sqrt(d1x*d1x + d1y*d1y);
    const p1x = ix - (d1x/l1)*round, p1y = iy - (d1y/l1)*round;
    const d2x = nox - ix, d2y = noy - iy, l2 = Math.sqrt(d2x*d2x + d2y*d2y);
    const p2x = ix + (d2x/l2)*round, p2y = iy + (d2y/l2)*round;
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(ix, iy, p2x, p2y);
  }
  ctx.closePath();
}

function hslColor(h, s, l) { return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`; }
function getH1Color(label) { return hslColor(getBaseHue(label), 92, 73); }

function extractHue(color) {
  if (!color) return 0;
  const m = color.match(/hsl\((\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function getSaturation(color) {
  if (!color) return 70;
  const m = color.match(/hsl\(\d+(?:\.\d+)?,\s*(\d+(?:\.\d+)?)%/);
  return m ? parseFloat(m[1]) : 70;
}

function hexToRgb(hex) {
  if (!hex) return [150,150,150];
  if (hex.startsWith('hsl')) {
    const m = hex.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/);
    if (!m) return [150,150,150];
    let h = parseFloat(m[1])/360, s = parseFloat(m[2])/100, l = parseFloat(m[3])/100;
    if (s === 0) { const v = Math.round(l*255); return [v,v,v]; }
    const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    return [Math.round(hue2rgb(p,q,h+1/3)*255), Math.round(hue2rgb(p,q,h)*255), Math.round(hue2rgb(p,q,h-1/3)*255)];
  }
  if (hex[0] !== '#') return [150,150,150];
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function rgbStr(rgb, a=1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanLabel(str) {
  if (!str) return '';
  return str
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '$1') // 마크다운 링크는 텍스트만 남김
    .replace(/\{([^}]*)\}/g, '$1').trim(); // 리터럴 [ ] # ` 는 보존
}

function cleanDesc(str) {
  if (!str) return '';
  // [텍스트](url) 링크는 보존. 링크 아닌 구간에서만 대괄호/# 제거(기울임*·코드`·화살표→는 보존)
  const clean = s => s.replace(/[\[\]#]/g, '').replace(/\{[^}]*\}/g, '');
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let out = '', last = 0, m;
  while ((m = linkRe.exec(str))) { out += clean(str.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
  out += clean(str.slice(last));
  return out.trim();
}

// 본문 블록 마커 다음 줄에서 노션 rich_text 원문 추출(목록/인용 접두·들여쓰기만 제거, **·~~ 서식 마커는 보존)
function bodyBlockText(line) {
  return (line || '').replace(/^\s+/, '').replace(/^(?:[-*]\s+|\d+\.\s+|>\s+)/, '').trim();
}

// 본문 줄머리 목록 마커를 편집기 표시용 기호로 반환 (저장 텍스트엔 안 들어감, 시각 표시 전용)
function _listMark(line) {
  const t = (line || '').replace(/^\s+/, '');
  let m;
  if ((m = t.match(/^(\d+)\.\s+/))) return m[1] + '.';
  if (/^[-*]\s+/.test(t)) return '•';
  if (/^(?:☑|\[[xX]\])\s+/.test(t)) return '☑';
  if (/^(?:☐|\[ ?\])\s+/.test(t)) return '☐';
  if (/^>\s+/.test(t)) return '❝';
  return '';
}

// 노드 표시용 텍스트 헬퍼 — 제목 없으면 '(제목 없음)', 본문은 trim(+선택적 길이 제한)
function nodeTitle(n) { return ((n && n.label) || '(제목 없음)').trim(); }
function nodeBody(n, len) { const b = ((n && n.desc) || '').trim(); return len ? b.slice(0, len) : b; }

function dist(a, b) { return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2); }

function getChildCount(nodeId) {
  return edges.filter(e => e.from === nodeId && !e.weakLink && !e.manualLink).length;
}

// ── 그래프 순회 공용 헬퍼 (여러 파일에서 복붙되던 부모/조상 순회를 일원화) ──
// 위계 부모 엣지(약한/수동 링크 제외). 없으면 null.
function getParentEdge(id) { return edges.find(e => e.to === id && !e.weakLink && !e.manualLink) || null; }
// 부모 id. structural=false면 수동링크도 부모로 인정(!weakLink만 — 검색/하이라이트용).
function getParentIdOf(id, structural) {
  const pe = (structural === false) ? edges.find(e => e.to === id && !e.weakLink) : getParentEdge(id);
  return pe ? pe.from : null;
}
// 조상 id 목록(부모→루트). structural=false면 수동링크 통과(!weakLink만).
function getAncestorIds(id, max, structural) {
  const out = []; let cur = id; const lim = max || 30;
  for (let i = 0; i < lim; i++) { const p = getParentIdOf(cur, structural); if (p == null) break; out.push(p); cur = p; }
  return out;
}
