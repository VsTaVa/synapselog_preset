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
    panel:     { rgb: [39,174,96],   glyph: 'info' },
    select:    { rgb: acc, ink: BADGE_INK_DARK, glyph: 'check' },
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
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('select')}</span><span>선택한 노드</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('panel')}</span><span>상세 내용 열림</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('fixed')}</span><span>노드 고정</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('bookmark')}</span><span>북마크</span></div>`
      + `<div class="lg-row"><span class="lg-shape">${_legendBadgeImg('satellite')}</span><span>격리 모드</span></div>`
    + `</div>`;
}
// 하위 노드 추가 — 우클릭 툴바와 우측 패널 메뉴가 같이 쓴다(둘 다 바꿔야 해서 한 곳에 둔다)
// viewBox는 그림 경계에 맞춰 잘라낸 값 — 원본 1024 상자엔 여백이 커서 옆 아이콘보다 작아 보였다
const ADD_CHILD_PATH = 'M 515.50 872.99 C480.02,865.71 450.43,844.68 431.73,813.46 C424.76,801.83 419.17,786.49 416.51,771.69 C414.89,762.72 414.79,745.32 416.25,726.22 L 416.50 722.93 L 326.00 668.88 C276.23,639.15 234.31,614.20 232.85,613.44 C230.34,612.13 229.80,612.31 223.36,616.63 C210.12,625.51 194.56,632.02 178.00,635.61 C166.14,638.18 140.86,638.18 129.00,635.61 C103.75,630.13 82.71,618.77 64.97,601.03 C50.43,586.49 41.05,571.28 34.44,551.51 C10.04,478.60 58.36,400.00 134.66,388.50 C168.34,383.42 202.48,392.27 230.11,413.24 L 239.10 420.07 L 328.88 363.51 L 418.67 306.95 L 416.86 297.73 C414.55,285.88 414.39,263.51 416.55,251.86 C419.74,234.58 425.86,219.42 435.46,205.00 C454.89,175.83 483.56,156.88 517.86,150.55 C528.80,148.52 551.20,148.52 562.14,150.55 C576.63,153.22 591.93,158.85 603.50,165.76 C635.03,184.59 656.80,215.86 663.45,251.86 C665.48,262.80 665.48,285.20 663.45,296.14 C657.77,326.90 641.57,353.81 617.50,372.46 C593.80,390.82 569.92,399.00 540.00,399.00 C511.25,399.00 486.60,390.89 464.71,374.23 C460.62,371.12 458.56,370.11 457.71,370.81 C457.04,371.36 416.00,397.31 366.50,428.49 C317.00,459.66 276.45,485.24 276.39,485.33 C276.33,485.43 276.87,489.33 277.58,494.00 C280.02,509.86 278.77,531.72 274.64,545.26 L 273.19 550.03 L 312.84 573.69 C334.65,586.70 375.37,610.99 403.33,627.67 L 454.17 657.98 L 462.33 651.66 C486.27,633.15 510.01,625.00 540.00,625.00 C559.26,625.00 574.96,628.25 592.00,635.75 C604.36,641.20 621.24,653.19 630.53,663.12 C653.71,687.90 665.00,716.35 665.00,750.00 C665.00,779.92 656.82,803.80 638.46,827.50 C619.81,851.57 592.90,867.77 562.14,873.45 C550.42,875.62 527.21,875.39 515.50,872.99 ZM 817.00 676.13 C802.51,671.47 791.48,659.62 787.53,644.47 C786.28,639.65 786.00,631.26 786.00,598.29 L 786.00 558.00 L 745.71 558.00 C712.74,558.00 704.35,557.72 699.53,556.47 C679.11,551.15 666.00,534.16 666.00,513.00 C666.00,491.84 679.11,474.85 699.53,469.53 C704.35,468.28 712.74,468.00 745.71,468.00 L 786.00 468.00 L 786.00 427.71 C786.00,394.74 786.28,386.35 787.53,381.53 C792.85,361.11 809.84,348.00 831.00,348.00 C852.16,348.00 869.15,361.11 874.47,381.53 C875.72,386.35 876.00,394.74 876.00,427.71 L 876.00 468.00 L 916.29 468.00 C949.26,468.00 957.65,468.28 962.47,469.53 C982.89,474.85 996.00,491.84 996.00,513.00 C996.00,534.16 982.89,551.15 962.47,556.47 C957.65,557.72 949.26,558.00 916.29,558.00 L 876.00 558.00 L 876.00 598.29 C876.00,631.26 875.72,639.65 874.47,644.47 C870.47,659.79 859.40,671.58 844.66,676.18 C837.10,678.54 824.44,678.51 817.00,676.13 Z';
// 가로로 넓고 낮은 채움 도안이라 같은 px에서 옆의 선 아이콘보다 작아 보인다 → 광학 보정 1.3배
const addChildIcon = (px) => `<svg width="${px * 1.3}" height="${px * 1.3}" viewBox="10 19 986 986" fill="currentColor"><path d="${ADD_CHILD_PATH}"/></svg>`;
// 포커스 모드 — 빛줄기가 뻗는 손전등. viewBox는 도안 경계에 맞춰 잘라낸 값
const FOCUS_PATH = 'M 220.10 1008.45 C197.38,1003.52 168.00,988.27 139.50,966.61 C104.66,940.14 67.32,899.94 45.49,865.41 C33.21,845.99 22.89,821.99 20.04,806.24 C18.63,798.42 18.57,782.86 19.94,776.75 C21.64,769.18 24.81,761.63 28.47,756.41 C30.37,753.71 86.17,697.28 152.47,631.00 L 273.02 510.50 L 269.99 502.75 C268.32,498.49 265.74,490.16 264.24,484.25 C261.80,474.61 261.52,471.75 261.53,456.50 C261.55,440.63 261.74,438.95 264.31,431.29 C265.88,426.61 269.18,419.94 271.97,415.79 C275.59,410.41 299.37,386.06 362.69,322.93 C454.91,230.97 451.14,234.36 467.00,228.97 C476.21,225.85 497.88,225.09 510.50,227.46 C560.40,236.83 624.65,277.70 686.59,339.47 C732.70,385.44 764.07,427.45 784.95,471.18 C797.45,497.35 802.44,516.28 802.42,537.50 C802.41,556.38 799.48,566.42 789.72,581.00 C785.56,587.22 627.15,745.82 618.50,752.42 C610.10,758.83 603.96,762.02 593.97,765.15 C587.61,767.14 584.42,767.49 572.50,767.47 C556.36,767.45 547.55,765.89 530.00,759.95 L 518.50 756.05 L 396.00 878.40 C282.72,991.55 273.01,1000.98 267.00,1003.85 C263.42,1005.56 257.82,1007.64 254.54,1008.48 C247.10,1010.38 228.91,1010.36 220.10,1008.45 ZM 450.71 717.42 C450.59,717.33 445.10,713.20 438.50,708.24 C396.33,676.55 351.83,632.06 320.07,589.85 L 311.30 578.19 L 202.68 686.85 L 94.05 795.50 L 97.35 803.50 C115.68,847.97 181.03,913.32 225.50,931.65 L 233.50 934.95 L 342.21 826.27 C402.00,766.49 450.82,717.51 450.71,717.42 ZM 622.91 642.59 L 673.32 592.17 L 661.07 586.03 C640.15,575.55 618.16,561.42 593.86,542.86 C558.42,515.80 515.23,472.58 485.20,434.15 C469.08,413.51 447.57,379.44 439.43,361.63 L 436.74 355.76 L 386.02 406.48 L 335.30 457.20 L 336.13 461.85 C341.03,488.99 368.74,534.45 406.02,576.50 C418.60,590.68 448.67,620.15 461.50,630.86 C491.75,656.12 522.70,676.33 546.00,686.03 C554.18,689.44 566.04,692.86 570.00,692.94 C572.01,692.99 582.61,682.90 622.91,642.59 ZM 727.00 529.90 C727.00,526.83 720.26,509.35 715.13,499.10 C680.24,429.40 592.59,342.87 524.46,310.86 C515.02,306.42 499.02,300.87 497.83,301.61 C496.29,302.55 502.60,320.11 509.28,333.50 C525.81,366.64 553.33,402.53 590.93,440.00 C634.65,483.58 681.22,516.45 715.50,527.94 C725.40,531.26 727.00,531.53 727.00,529.90 ZM 843.50 504.61 C832.39,501.05 824.46,494.21 819.59,484.00 C816.85,478.23 816.50,476.49 816.50,468.50 C816.50,460.51 816.85,458.77 819.59,453.00 C821.30,449.42 824.67,444.52 827.09,442.09 C829.52,439.67 834.42,436.30 838.00,434.59 L 844.50 431.50 L 917.50 431.50 L 990.50 431.50 L 997.00 434.59 C1005.26,438.53 1011.47,444.74 1015.41,453.00 C1018.15,458.77 1018.50,460.51 1018.50,468.50 C1018.50,476.49 1018.15,478.23 1015.41,484.00 C1011.47,492.26 1005.26,498.47 997.00,502.41 L 990.50 505.50 L 919.00 505.70 C863.17,505.85 846.62,505.61 843.50,504.61 ZM 755.50 306.66 C744.23,302.92 736.44,296.19 731.59,286.00 C728.85,280.23 728.50,278.49 728.50,270.50 C728.50,262.40 728.83,260.80 731.80,254.50 C734.89,247.95 738.26,244.35 784.30,198.38 C841.59,141.19 838.57,143.50 856.00,143.50 C865.42,143.50 867.07,143.78 872.07,146.24 C879.30,149.79 886.19,156.65 889.70,163.80 C892.23,168.94 892.50,170.53 892.50,180.00 C892.50,197.42 894.80,194.41 837.61,251.69 C791.65,297.73 788.06,301.10 781.58,304.12 C773.54,307.87 762.42,308.95 755.50,306.66 ZM 559.70 209.08 C550.01,205.20 541.58,196.65 537.91,186.99 C536.04,182.07 535.97,179.10 536.23,108.69 L 536.50 35.50 L 539.22 29.97 C542.69,22.90 549.90,15.69 556.97,12.22 C561.92,9.78 563.60,9.50 573.00,9.50 C582.40,9.50 584.08,9.78 589.03,12.22 C596.10,15.69 603.31,22.90 606.78,29.97 L 609.50 35.50 L 609.50 110.00 L 609.50 184.50 L 606.78 190.03 C603.31,197.10 596.10,204.31 589.03,207.78 C581.62,211.42 567.15,212.06 559.70,209.08 Z';
const focusModeIcon = (px) => `<svg width="${px}" height="${px}" viewBox="18 9 1001 1001" fill="currentColor"><path d="${FOCUS_PATH}"/></svg>`;
// 격리 모드 — 가운데 축에서 양옆으로 밀려나는 화살표. viewBox는 도안 경계에 맞춰 잘라낸 값
const ISOLATE_PATH = 'M 495.50 1007.47 C493.30,1006.68 490.71,1006.02 489.75,1006.02 C486.95,1005.99 475.02,1000.07 468.45,995.45 C456.83,987.26 444.45,970.43 442.00,959.50 C441.51,957.30 440.63,953.47 440.04,951.00 C439.29,947.83 439.05,816.38 439.24,507.00 C439.49,87.22 439.59,67.30 441.30,63.00 C442.28,60.53 443.74,57.08 444.54,55.35 C445.35,53.62 446.00,51.88 446.00,51.49 C446.00,51.11 447.35,48.79 449.00,46.34 C450.65,43.90 452.01,41.58 452.01,41.20 C452.04,40.12 467.13,25.63 470.50,23.46 C475.87,20.00 486.45,15.00 488.50,14.97 C489.60,14.95 491.62,14.29 493.00,13.50 C496.62,11.43 521.70,11.43 526.65,13.50 C528.63,14.32 530.93,15.00 531.78,15.00 C534.12,15.00 545.69,20.71 551.92,24.95 C558.60,29.49 565.14,36.33 570.62,44.50 C575.69,52.05 578.23,57.71 580.34,66.16 C581.87,72.33 582.00,105.89 582.00,511.95 C582.00,950.79 582.00,951.07 579.97,957.10 C578.85,960.42 577.52,963.89 577.02,964.82 C576.51,965.74 575.31,968.30 574.36,970.50 C571.95,976.03 565.19,984.71 558.56,990.77 C553.09,995.77 542.24,1003.00 540.20,1003.00 C539.63,1003.00 537.89,1003.62 536.33,1004.38 C529.13,1007.90 523.11,1009.00 511.37,1008.96 C503.65,1008.93 498.10,1008.41 495.50,1007.47 ZM 223.00 737.10 C216.81,736.28 208.29,732.67 201.49,727.99 C198.98,726.27 156.99,684.95 108.19,636.18 C12.87,540.93 14.26,542.46 10.06,528.00 C9.03,524.42 7.88,518.05 7.51,513.83 C6.81,505.76 8.11,499.11 12.11,490.39 C13.15,488.13 14.00,485.97 14.00,485.58 C14.00,483.88 22.13,474.50 34.02,462.50 C41.10,455.35 81.46,415.05 123.70,372.95 C205.85,291.07 200.70,295.70 217.28,288.62 C222.62,286.34 244.36,286.33 249.72,288.61 C262.53,294.07 270.95,299.72 277.00,306.95 C281.44,312.25 287.89,323.84 287.95,326.64 C287.98,327.81 288.67,330.06 289.49,331.64 C292.60,337.59 290.93,355.42 286.43,364.33 C285.64,365.89 285.00,367.56 285.00,368.05 C285.00,371.32 272.31,385.24 239.48,418.00 L 201.89 455.50 L 276.20 456.07 C347.11,456.62 350.73,456.74 355.50,458.62 C362.86,461.54 366.90,463.78 372.62,468.14 C377.57,471.91 387.00,482.83 387.00,484.79 C387.00,485.32 387.67,486.32 388.50,487.00 C389.33,487.68 390.00,488.98 390.01,489.87 C390.01,490.77 390.77,492.85 391.70,494.50 C394.23,498.99 393.99,523.47 391.35,530.50 C388.46,538.19 383.18,546.77 378.10,552.03 C373.32,556.98 364.32,563.17 360.00,564.48 C358.62,564.90 357.03,565.61 356.47,566.07 C353.72,568.25 341.65,569.49 325.50,569.25 C298.39,568.85 204.00,570.17 204.00,570.94 C204.00,571.33 217.55,585.11 234.10,601.57 C279.40,646.60 279.40,646.60 283.79,655.41 C289.00,665.85 290.41,671.59 290.35,682.00 C290.30,689.55 289.74,693.15 287.60,699.50 C286.13,703.90 284.04,708.72 282.96,710.21 C281.88,711.70 281.00,713.16 281.00,713.45 C281.00,714.28 276.92,718.96 272.50,723.23 C268.08,727.49 257.74,734.00 255.40,734.00 C254.57,734.00 252.64,734.65 251.11,735.44 C247.79,737.16 230.93,738.15 223.00,737.10 ZM 775.50 737.36 C767.16,736.42 750.64,726.29 743.76,717.88 C739.71,712.93 733.00,700.57 733.00,698.06 C733.00,697.15 732.44,695.84 731.75,695.15 C730.08,693.48 730.00,669.91 731.66,667.90 C732.30,667.13 733.14,664.81 733.52,662.74 C733.91,660.67 734.59,658.76 735.03,658.48 C735.47,658.21 736.84,655.85 738.07,653.24 C739.75,649.70 749.91,638.86 778.41,610.23 C799.36,589.19 816.50,571.51 816.50,570.94 C816.50,570.25 795.16,569.93 751.00,569.97 C677.44,570.03 672.64,569.67 658.50,563.03 C649.79,558.94 636.55,546.16 633.06,538.50 C631.81,535.75 630.16,532.15 629.41,530.50 C627.46,526.27 626.64,512.86 627.78,503.98 C630.09,485.99 642.82,468.81 659.50,461.17 C662.25,459.91 665.40,458.34 666.50,457.69 C667.98,456.81 687.79,456.43 743.25,456.21 C801.00,455.99 818.00,455.65 818.00,454.72 C818.00,454.05 802.11,437.75 782.68,418.50 C745.76,381.91 740.45,376.04 736.59,367.62 C729.20,351.47 728.96,339.06 735.66,320.50 C738.03,313.92 744.22,305.87 751.81,299.50 C758.85,293.59 762.27,291.83 772.86,288.62 C779.67,286.57 795.90,286.51 801.50,288.53 C803.70,289.32 806.10,289.98 806.83,289.98 C808.76,290.01 820.92,297.42 825.00,301.06 C829.55,305.13 967.80,443.02 988.01,463.66 C1004.93,480.93 1008.22,485.80 1011.90,499.06 C1014.39,508.05 1014.70,521.16 1012.50,525.00 C1011.71,526.38 1011.05,528.48 1011.04,529.67 C1010.99,532.71 1006.66,540.99 1002.14,546.69 C999.18,550.42 909.19,640.59 832.62,716.55 C823.36,725.73 818.22,729.78 812.50,732.41 C810.30,733.42 807.21,734.87 805.64,735.64 C802.69,737.08 783.03,738.20 775.50,737.36 Z';
const isolateModeIcon = (px) => `<svg width="${px}" height="${px}" viewBox="7 6 1008 1008" fill="currentColor"><path d="${ISOLATE_PATH}"/></svg>`;
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
    + row('격리 모드', '그래프 분리')
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
// 공통 토글 — 단일/멀티 연결에서 모두 사용
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

// 탐색 툴: 연결 / 포커스 / 격리 (선택 개수에 따라 달라짐)
function _exploreToolsHtml() {
  const n = _multiSelected.length;
  const chainIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const focusIcon = focusModeIcon(13);
  let html = '';
  if (n === 1) {
    html += `<button onclick="multiSelectStartConnect()" title="해당 노드를 다른 노드들과 연결/해제">${chainIcon} 노드 다중 연결</button>`;
    // 고정·격리 버튼과 같은 방식 — 켜져 있으면 해제 버튼으로 보인다
    const focusOn = _focusMode && _focusNodeId === _multiSelected[0].id;
    html += `<button onclick="multiSelectFocus()" title="${focusOn ? '포커스 모드 해제' : '해당 노드의 상/하위 노드만 표시'}">${focusIcon} ${focusOn ? '포커스 해제' : '포커스 모드'}</button>`;
  } else if (n === 2) {
    html += `<button onclick="multiSelectConnect()" title="선택한 두 노드를 연결/해제">${chainIcon} 노드 간 연결</button>`;
  }
  const satOn = _multiSelected.every(nd => nd._satelliteRoot);
  html += `<button onclick="multiSelectSatellite()" title="선택한 노드와 하위 노드를 상위에서 분리/복원">${isolateModeIcon(13)} 격리 모드${satOn ? ' 해제' : ''}</button>`;
  const pinOn = _multiSelected.length > 0 && _multiSelected.every(nd => nd.fixed);
  const pinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${pinOn ? 'rgba(237,112,0,0.25)' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
  html += `<button onclick="multiSelectPin()" title="선택한 노드를 제자리에 고정/해제">${pinIcon} ${pinOn ? '고정 해제' : '노드 고정'}</button>`;
  return html;
}

