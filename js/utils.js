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

// 마크다운 서식을 전부 벗긴 순수 표시용 제목.
// 라벨(node.label)은 반드시 이 값이어야 한다 — 검색·위키링크 매칭·_stableNodeKey(북마크/임베딩
// 영속 키)·노드 색(getH1Color)이 전부 라벨을 쓰므로, 여기에 '~~'나 백틱이 새면 조용히 다 어긋난다.
// cleanLabel은 리터럴 보존 목적으로 '~~'와 백틱을 남기므로 그 둘을 먼저 떼고 넘긴다.
function plainLabel(md) {
  return cleanLabel(String(md || '').replace(/~~([^~]+)~~/g, '$1').replace(/`([^`]+)`/g, '$1'));
}

// 마크다운 제목 → HTML (보이는 글자 수 기준으로 자름).
// 문자열을 먼저 자르면 '**' 한가운데가 잘려 서식이 깨지므로, 파싱하면서 세어 자른다.
// 토글 규칙은 api/notion.js의 buildRichText와 동일. 링크는 칩에선 텍스트만 남긴다.
function labelMdToHtml(md, maxLen) {
  const t = String(md || '');
  let i = 0, out = '', buf = '', shown = 0, cut = false;
  let bold = false, italic = false, strike = false, code = false;
  const open = () => (bold ? '<strong>' : '') + (italic ? '<em>' : '') + (strike ? '<del>' : '') + (code ? '<code>' : '');
  const close = () => (code ? '</code>' : '') + (strike ? '</del>' : '') + (italic ? '</em>' : '') + (bold ? '</strong>' : '');
  const flush = () => { if (buf) { out += open() + escapeHtml(buf) + close(); buf = ''; } };
  const push = (s) => {
    for (const ch of s) { // 코드포인트 단위 — 한글·이모지가 반 글자로 안 잘리게
      if (maxLen && shown >= maxLen) { cut = true; return; }
      buf += ch; shown++;
    }
  };
  const linkRe = /^\[([^\]]*)\]\(([^)\s]+)\)/;
  while (i < t.length && !cut) {
    if (t.startsWith('**', i)) { flush(); bold = !bold; i += 2; }
    else if (t.startsWith('~~', i)) { flush(); strike = !strike; i += 2; }
    else if (t[i] === '`') { flush(); code = !code; i += 1; }
    else if (t[i] === '*' && t[i + 1] !== '*') { flush(); italic = !italic; i += 1; }
    else if (t[i] === '[') {
      const m = linkRe.exec(t.slice(i));
      if (m) { push(m[1]); i += m[0].length; }
      else { push(t[i]); i++; }
    }
    else { push(t[i]); i++; }
  }
  flush();
  return out + (cut ? '…' : '');
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

// 본문 블록 마커 다음 줄에서 노션 rich_text 원문 추출(목록/인용/체크박스 접두·들여쓰기만 제거, **·~~ 서식 마커는 보존)
// 체크박스 글리프(☑/☐)도 반드시 떼야 함 — 남겨두면 저장할 때마다 rich_text에 다시 들어가 '☑ ☑ ☑ …'로 불어난다
function bodyBlockText(line) {
  const raw = (line || '').replace(/^\s+/, '');
  const isQuote = /^>{1,2}[ \t]+/.test(raw);
  // 콜아웃/인용 마커를 먼저 떼고, 그 뒤에 남은 목록·체크박스 마커도 뗀다.
  // 콜아웃 안의 불릿은 '>> - 항목'처럼 마커가 겹쳐 오는데, 하나만 떼면 '- '가 텍스트에 남아
  // 저장할 때마다 노션 본문에 그대로 쌓인다(☑ 중복과 같은 유형의 버그).
  let t = raw.replace(/^(?:>>\s+|>\s+)/, '');
  t = t.replace(/^(?:[-*]\s+|\d+\.\s+|(?:☑|☐|\[[xX]\]|\[ ?\])\s+)/, '');
  // 인용은 소프트 줄바꿈이 있으면 줄마다 마커가 붙어 오므로 이어지는 줄의 마커도 뗀다.
  // (첫 줄이 인용일 때만 — 평범한 문단의 둘째 줄에 있는 '>'는 진짜 내용이라 건드리면 안 됨)
  return (isQuote ? t.replace(/^[ \t]*>{1,2}[ \t]+/gm, '') : t).trim();
}

// 본문 줄머리 마커 → 노션 블록 유형. 블록을 다시 만들 때(재정렬 등) 원래 유형을 되살리는 데 씀.
// 콜아웃은 마커 없이 오므로 여기선 못 가려냄 → 서버(headingNode)가 준 type을 우선 쓴다.
function _blockTypeOf(line) {
  const t = (line || '').replace(/^\s+/, '');
  if (/^---+\s*$/.test(t)) return 'divider';
  if (/^\d+\.\s+/.test(t)) return 'numbered_list_item';
  if (/^[-*]\s+/.test(t)) return 'bulleted_list_item';
  if (/^(?:☑|☐|\[[xX]\]|\[ ?\])\s+/.test(t)) return 'to_do';
  if (/^>>\s+/.test(t)) return 'callout';
  if (/^>\s+/.test(t)) return 'quote';
  return 'paragraph';
}

function _blockChecked(line) { return /^\s*(?:☑|\[[xX]\])\s+/.test(line || ''); }

// bodyBlocks 항목 → 보기(desc)용 한 줄. 저장 후 desc를 다시 만들 때 줄머리 표식이 사라지지 않게 복원
function _bodyDescLine(b) {
  const t = (b && b.type) || 'paragraph';
  const tx = (b && b.text) || '';
  if (t === 'bulleted_list_item') return '- ' + tx;
  if (t === 'numbered_list_item') return (/^\d+\.$/.test(b.mark || '') ? b.mark : '1.') + ' ' + tx;
  if (t === 'to_do') return (b.checked ? '☑ ' : '☐ ') + tx;
  if (t === 'quote') return tx.split('\n').map(l => '> ' + l).join('\n');
  if (t === 'callout') return tx.split('\n').map(l => '>> ' + l).join('\n');
  if (t === 'divider') return '---';
  return tx;
}

// 본문 줄머리 목록 마커를 편집기 표시용 기호로 반환 (저장 텍스트엔 안 들어감, 시각 표시 전용)
function _listMark(line) {
  const t = (line || '').replace(/^\s+/, '');
  let m;
  if ((m = t.match(/^(\d+)\.\s+/))) return m[1] + '.';
  if (/^[-*]\s+/.test(t)) return '•';
  if (/^(?:☑|\[[xX]\])\s+/.test(t)) return '☑';
  if (/^(?:☐|\[ ?\])\s+/.test(t)) return '☐';
  if (/^>>\s+/.test(t)) return '💡'; // 콜아웃 — 표시는 _markHtml이 전구 아이콘으로 바꿈
  if (/^>\s+/.test(t)) return '❝';
  return '';
}

// 콜아웃 마커는 글리프(▍) 대신 전구 아이콘으로 — 노션의 콜아웃 느낌에 가깝고
// 다른 줄머리 기호(•/숫자/☑/❝)와 한눈에 구분된다. 나머지는 글자 그대로.
function _markHtml(mark) {
  if (mark === '💡') return `<svg class="body-edit-mark-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`;
  return escapeHtml(mark || '');
}

// 띄어쓰기 무시 검색용 정규식 — 키워드의 공백을 없애고 각 글자 사이에 \s* 허용.
// "시장경제흐름" / "시장 경제 흐름" 어느 쪽으로 검색해도 "시장 경제 흐름" 텍스트를 매칭·강조.
function _kwRegex(kw, flags) {
  const chars = (kw || '').trim().replace(/\s+/g, '').split('');
  if (!chars.length) return null;
  const src = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp('(' + src + ')', flags || 'gi');
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
