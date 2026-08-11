// ── 그래프 PNG 내보내기 ─────────────────────────────────────────────
// 화면(draw)과 같은 공식으로 오프스크린 캔버스에 다시 그린다 — 규칙이 갈리면 내보낸 그림만 달라진다

// 설정 창의 이미지 내보내기 — 고른 크기를 기억하고, 저장 진행/결과가 보이도록 설정 창을 닫는다
function exportGraphAt(size) {
  _exportSize = size;
  try { localStorage.setItem('snlog_export_size', String(size)); } catch (e) {}
  if (typeof closeSettings === 'function') closeSettings();
  exportGraph(size);
}

function exportGraph(size) {
  const SIZE = size || _exportSize || 2048, PADDING = Math.round(SIZE * 0.05); // 크기에 비례(고정 60은 큰 이미지에서 너무 좁았음)
  const hasSearch = searchKeyword.length > 0;
  const visibleNodes = nodes.filter(n => {
    if (!n.visible) return false;
    if (_focusMode && n.dimmed) return false;
    if (hasSearch && !searchMatches.has(n.id)) return false;
    return true;
  });
  if (visibleNodes.length === 0) return;
  // 뷰 회전 반영: 그래프 중심 기준으로 노드 좌표를 회전시켜 사용(라벨은 아래·수평 유지)
  const _rot = (typeof _viewRotation === 'number') ? _viewRotation : 0;
  const _cos = Math.cos(_rot), _sin = Math.sin(_rot);
  const _cx0 = (Math.min(...visibleNodes.map(n => n.x)) + Math.max(...visibleNodes.map(n => n.x))) / 2;
  const _cy0 = (Math.min(...visibleNodes.map(n => n.y)) + Math.max(...visibleNodes.map(n => n.y))) / 2;
  const RP = new Map();
  visibleNodes.forEach(n => { const dx = n.x - _cx0, dy = n.y - _cy0; RP.set(n.id, { x: _cx0 + dx * _cos - dy * _sin, y: _cy0 + dx * _sin + dy * _cos }); });
  const _px = id => RP.get(id) || { x: 0, y: 0 };
  const rxv = visibleNodes.map(n => RP.get(n.id).x), ryv = visibleNodes.map(n => RP.get(n.id).y);
  // 경계를 노드 '중심'으로만 잡으면 별 모양(반지름의 2배까지 뻗음)과 아래에 붙는 라벨이
  // 그림 밖으로 잘린다. 노드마다 실제로 그려지는 범위를 더해 경계를 넓힌다.
  const _ext = n => nodeR(n.level) * 2.2;                       // 별 최대 반경 2.0r + 링 여유
  const _lblH = n => nodeR(n.level) + 4 + (n.level <= 1 ? 12 : 10) * (typeof _labelScale === 'number' ? _labelScale : 1);
  const minX = Math.min(...visibleNodes.map(n => RP.get(n.id).x - _ext(n)));
  const maxX = Math.max(...visibleNodes.map(n => RP.get(n.id).x + _ext(n)));
  const minY = Math.min(...visibleNodes.map(n => RP.get(n.id).y - _ext(n)));
  const maxY = Math.max(...visibleNodes.map(n => RP.get(n.id).y + _lblH(n))); // 라벨은 아래로만
  const graphW = maxX - minX || 1, graphH = maxY - minY || 1;
  const exportScale = (SIZE - PADDING * 2) / Math.max(graphW, graphH);
  const offscreen = document.createElement('canvas');
  offscreen.width = SIZE; offscreen.height = SIZE;
  const ctx2 = offscreen.getContext('2d');
  const EXPORT_BG = [10,12,20];
  ctx2.fillStyle = rgbStr(EXPORT_BG, 1); ctx2.fillRect(0, 0, SIZE, SIZE);
  const offsetX = (SIZE - graphW * exportScale) / 2 - minX * exportScale;
  const offsetY = (SIZE - graphH * exportScale) / 2 - minY * exportScale;
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  // 선 굵기 환산 — ctx2가 exportScale로 확대돼 있으므로 "원하는 출력 px"을 그 값으로 나눠 넣는다.
  // 기준 화면 폭 1000px 대비 SIZE 비율만큼 키워야 4096으로 뽑아도 2048과 같은 인상이 된다.
  // (예전엔 월드 단위 상수라 그래프가 클수록 선이 머리카락처럼 얇아졌다)
  const LW = (SIZE / 1000) / exportScale;
  ctx2.save(); ctx2.translate(offsetX, offsetY); ctx2.scale(exportScale, exportScale);
  edges.forEach(e => {
    const a = nodeMap[e.from], b = nodeMap[e.to];
    if (!a?.visible || !b?.visible || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return;
    // 화면과 같은 규칙 — 선 색은 하위(도착) 노드 기준
    const edgeRgb = _colorScheme === 'depth' ? nodeRgb(b) : (b._rgb || hexToRgb(b.color || '#ffffff'));
    if (hasSearch) {
      const bothMatch = searchMatches.has(e.from) && searchMatches.has(e.to);
      const eitherMatch = searchMatches.has(e.from) || searchMatches.has(e.to);
      if (!eitherMatch) return;
      ctx2.setLineDash(bothMatch ? [] : [4,5]);
      ctx2.strokeStyle = rgbStr(edgeRgb, bothMatch ? 0.9 : 0.3);
      ctx2.lineWidth = (bothMatch ? 1.6 : 0.8) * CONFIG.linkWidth * LW;
    } else if (e.manualLink) { ctx2.setLineDash([4,5]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.6); ctx2.lineWidth = 1.8 * CONFIG.linkWidth * LW; }
    else if (e.weakLink) { ctx2.setLineDash([4,4]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.2); ctx2.lineWidth = 1.2 * CONFIG.linkWidth * LW; }
    else { ctx2.setLineDash([]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.55); ctx2.lineWidth = 1.0 * edgeDepthScale(b.level) * CONFIG.linkWidth * LW; } // 화면(draw)과 같은 공식
    const pa = _px(a.id), pb = _px(b.id);
    ctx2.beginPath(); ctx2.moveTo(pa.x, pa.y); ctx2.lineTo(pb.x, pb.y); ctx2.stroke();
  });
  ctx2.setLineDash([]);
  visibleNodes.forEach(n => {
    const p = _px(n.id), nx = p.x, ny = p.y;
    const r = nodeR(n.level), nodeColor = n.level === 0 ? '#ffffff' : (n.color || '#74b9ff');
    const rgb = _colorScheme === 'depth' ? nodeRgb(n) : hexToRgb(nodeColor), isMatch = searchMatches.has(n.id);
    if (hasSearch && isMatch) {
      ctx2.beginPath(); ctx2.arc(nx, ny, r+10, 0, Math.PI*2);
      const gS = ctx2.createRadialGradient(nx, ny, r, nx, ny, r+10);
      gS.addColorStop(0, 'rgba(255,255,255,0.4)'); gS.addColorStop(1, 'rgba(255,255,255,0)');
      ctx2.fillStyle = gS; ctx2.fill();
    }
    if (n.level > 0) {
      const hub = hubGlowSpec(getChildCount(n.id), r);
      if (hub) {
        ctx2.beginPath(); ctx2.arc(nx, ny, hub.radius, 0, Math.PI*2);
        const gH = ctx2.createRadialGradient(nx, ny, r, nx, ny, hub.radius);
        gH.addColorStop(0, rgbStr(rgb, hub.alpha)); gH.addColorStop(1, rgbStr(rgb, 0));
        ctx2.fillStyle = gH; ctx2.fill();
      }
    }
    if(n.level===0) drawStar8(ctx2, nx, ny, r);
    else if(n.isDbNode) drawStar4(ctx2, nx, ny, r);
    else if(n.isChildPage || n.entryNotionId) drawStarX(ctx2, nx, ny, r);
    else { ctx2.beginPath(); ctx2.arc(nx, ny, r, 0, Math.PI*2); }
    ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : rgbStr(rgb, 1); ctx2.fill();
    if (_labelScale > 0) {
      let lbl = n.label ? n.label.replace(/[\n]/g, ' ') : '';
      if (n.level >= 2 && lbl.length > 14) lbl = lbl.substring(0,13) + '…';
      const fontSize = (n.level <= 1 ? 12 : 10) * _labelScale;
      ctx2.font = n.level <= 1 ? `bold ${fontSize}px 'Noto Sans KR', sans-serif` : `500 ${fontSize}px 'Noto Sans KR', sans-serif`;
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
      // 화면과 같은 '제목 뒤 지움' — 그림자 블러를 페더로 써서 겹친 선·노드를 글자 주변에서 뺀다
      ctx2.fillStyle = rgbStr(EXPORT_BG, 1);
      ctx2.shadowColor = rgbStr(EXPORT_BG, 1);
      ctx2.shadowOffsetX = 0; ctx2.shadowOffsetY = 0;
      // 그림자 블러는 변환행렬을 안 타므로 출력 배율(exportScale)로 환산
      ctx2.shadowBlur = Math.max(2.5, fontSize * 0.5) * exportScale;
      ctx2.fillText(lbl, nx, ny + r + 4); ctx2.fillText(lbl, nx, ny + r + 4);
      ctx2.shadowColor = 'rgba(0,0,0,0)'; ctx2.shadowBlur = 0;
      ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : 'rgba(215,220,230,0.85)';
      ctx2.fillText(lbl, nx, ny + r + 4);
    }
  });
  ctx2.restore();
  const finalize = () => {
    // 우측 하단 워터마크: 로고만(흰색 + 투명도 50%)
    const pad = SIZE * 0.016, logoSize = Math.round(SIZE * 0.032);
    const x = SIZE - pad - logoSize, y = SIZE - pad - logoSize;
    if (_exportLogo && _exportLogo.complete && _exportLogo.naturalWidth) {
      try {
        // 로고를 흰색으로 틴트
        const tc = document.createElement('canvas'); tc.width = logoSize; tc.height = logoSize;
        const tctx = tc.getContext('2d');
        tctx.drawImage(_exportLogo, 0, 0, logoSize, logoSize);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, logoSize, logoSize);
        ctx2.globalAlpha = 0.5;
        ctx2.drawImage(tc, x, y);
        ctx2.globalAlpha = 1;
      } catch (e) {}
    }
    const link = document.createElement('a');
    link.download = `SynapseLog_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = offscreen.toDataURL('image/png'); link.click();
  };
  if (_exportLogo && !_exportLogo.complete) { _exportLogo.onload = finalize; _exportLogo.onerror = finalize; }
  else finalize();
}
const _exportLogo = (typeof Image !== 'undefined') ? Object.assign(new Image(), { src: 'icon.png' }) : null;
