export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, pageId, action } = req.body;
  if (!token) return res.status(400).json({ error: 'token 필요' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
  };

  // 마크다운(**볼드**, ~~취소선~~)을 노션 rich_text 배열로 변환 (쓰기용)
  function buildRichText(text) {
    if (!text) return [{ type: 'text', text: { content: '' } }];
    const out = [];
    let i = 0, buf = '', bold = false, strike = false, italic = false, code = false;
    const ann = () => ({ bold, italic, strikethrough: strike, code });
    const flush = () => { if (buf) { out.push({ type: 'text', text: { content: buf }, annotations: ann() }); buf = ''; } };
    const linkRe = /^\[([^\]]+)\]\(([^)\s]+)\)/;
    while (i < text.length) {
      if (text.startsWith('**', i)) { flush(); bold = !bold; i += 2; }
      else if (text.startsWith('~~', i)) { flush(); strike = !strike; i += 2; }
      else if (text[i] === '`') { flush(); code = !code; i += 1; }
      else if (text[i] === '*' && text[i + 1] !== '*') { flush(); italic = !italic; i += 1; }
      else if (text[i] === '[') {
        const m = linkRe.exec(text.slice(i));
        if (m) { flush(); out.push({ type: 'text', text: { content: m[1], link: { url: m[2] } }, annotations: ann() }); i += m[0].length; }
        else { buf += text[i]; i++; }
      }
      else { buf += text[i]; i++; }
    }
    flush();
    return out.length ? out : [{ type: 'text', text: { content: '' } }];
  }

  // 본문 한 줄의 줄머리 마크다운(- , 1. , > , 체크박스)을 노션 블록 타입으로 변환
  // (마커는 첫 줄 머리만 제거하고 나머지(소프트 줄바꿈 포함)는 보존)
  function lineToBlock(raw) {
    const t = raw || '';
    if (/^\s*[-*]\s+/.test(t)) return { type: 'bulleted_list_item', value: { rich_text: buildRichText(t.replace(/^\s*[-*]\s+/, '')) } };
    if (/^\s*\d+\.\s+/.test(t)) return { type: 'numbered_list_item', value: { rich_text: buildRichText(t.replace(/^\s*\d+\.\s+/, '')) } };
    if (/^\s*>>\s+/.test(t)) return { type: 'callout', value: { rich_text: buildRichText(t.replace(/^\s*>>\s+/, '')) } }; // 인용보다 먼저 — '>' 하나로 잡히면 안 됨
    if (/^\s*>\s+/.test(t)) return { type: 'quote', value: { rich_text: buildRichText(t.replace(/^\s*>\s+/, '')) } };
    if (/^\s*(?:☑|\[[xX]\])\s+/.test(t)) return { type: 'to_do', value: { rich_text: buildRichText(t.replace(/^\s*(?:☑|\[[xX]\])\s+/, '')), checked: true } };
    if (/^\s*(?:☐|\[ ?\])\s+/.test(t)) return { type: 'to_do', value: { rich_text: buildRichText(t.replace(/^\s*(?:☐|\[ ?\])\s+/, '')), checked: false } };
    return { type: 'paragraph', value: { rich_text: buildRichText(t) } };
  }

  // 프로필 조회
  if (action === 'profile') {
    try {
      const r = await fetch('https://api.notion.com/v1/users/me', { headers });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      const u = await r.json();
      const wr = await fetch('https://api.notion.com/v1/search', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: 1 })
      });
      const ws = await wr.json();
      return res.status(200).json({
        name: u.name || '',
        email: u.person?.email || '',
        avatar: u.avatar_url || '',
        workspace: ws.results?.[0]?.parent?.workspace_id ? '내 워크스페이스' : '내 워크스페이스'
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // 페이지 목록 조회
  if (action === 'list') {
    try {
      const pages = [];
      let cursor = undefined;
      do {
        // object 필터 없이 조회 — DB 항목의 부모는 데이터베이스라, DB를 빼면 항목들이 전부 부모 없는 상태가 됨
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const res2 = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res2.ok) { const e = await res2.json(); throw new Error(e.message || '목록 조회 실패'); }
        const data = await res2.json();
        for (const p of data.results) {
          const isDb = p.object === 'database';
          let title;
          if (isDb) {
            title = (p.title || []).map(t => t.plain_text || '').join('').trim();
          } else {
            const props = p.properties || {};
            const titleProp = Object.values(props).find(v => v.type === 'title');
            title = (titleProp?.title?.map(t => t.plain_text || '').join('') || p.child_page?.title || '').trim();
          }
          if (!title) continue;
          // 상위/하위 구분용 부모 정보 (parent.type: 'workspace' | 'page_id' | 'database_id' | 'block_id')
          const par = p.parent || {};
          const parentId = (par.page_id || par.database_id || par.block_id || '').replace(/-/g, '');
          const row = { id: p.id.replace(/-/g, ''), title, parentType: par.type || '', parentId, lastEdited: p.last_edited_time || '' };
          if (isDb) row.isDatabase = true; // 목록에선 부모 행으로만 표시(추가 대상 아님)
          pages.push(row);
        }
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);
      return res.status(200).json({ pages });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── action: 'updateBlock' — 기존 블록(헤딩/문단 등) 텍스트 수정 ──────
  if (action === 'updateBlock') {
    const { blockId, text, checked } = req.body;
    if (!blockId) return res.status(400).json({ error: 'blockId 필요' });
    try {
      // 블록 유형을 먼저 조회해 올바른 키로 PATCH (레벨 시프트와 무관하게 정확)
      const g = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, { headers });
      if (!g.ok) { const e = await g.json(); return res.status(g.status).json({ error: e.message || '블록 조회 실패' }); }
      const block = await g.json();
      const type = block.type;
      // heading_4는 읽기·생성 양쪽에서 다루므로 수정도 허용 (빠져 있어서 #### 노드 제목 변경이 실패했음)
      const EDITABLE = ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'paragraph', 'toggle', 'callout', 'quote', 'bulleted_list_item', 'numbered_list_item', 'to_do'];
      if (!EDITABLE.includes(type)) return res.status(400).json({ error: `이 블록 유형(${type})은 수정 불가` });

      const patchBody = { [type]: { rich_text: buildRichText(text || '') } };
      // 체크 상태는 텍스트와 별개 — 값이 올 때만 반영(안 오면 노션의 기존 상태 유지)
      if (type === 'to_do' && typeof checked === 'boolean') patchBody.to_do.checked = checked;
      const p = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody)
      });
      if (!p.ok) { const e = await p.json(); return res.status(p.status).json({ error: e.message || '수정 실패' }); }
      return res.status(200).json({ ok: true, type });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'appendBlock' — 헤딩 섹션 맨 끝(다음 헤딩 직전)에 새 블록 추가 ──
  if (action === 'appendBlock') {
    const { parentId, afterId, text, blockType } = req.body;
    if (!parentId) return res.status(400).json({ error: 'parentId 필요' });
    // 'heading'이면 부모 헤딩보다 한 단계 깊은 레벨로 자동 결정(아래에서)
    const wantHeading = blockType === 'heading';
    let type = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4'].includes(blockType) ? blockType : 'paragraph';
    try {
      const norm = id => (id || '').replace(/-/g, '');
      let afterTarget = afterId || null;
      // afterId가 있으면 그 헤딩 섹션의 끝 블록을 찾는다(없으면 부모 children 맨 끝에 추가)
      if (afterId) {
        const children = [];
        let cur;
        do {
          const r = await fetch(`https://api.notion.com/v1/blocks/${parentId}/children${cur ? `?start_cursor=${cur}` : ''}`, { headers });
          if (!r.ok) break;
          const d = await r.json();
          children.push(...d.results.filter(b => b?.type));
          cur = d.has_more ? d.next_cursor : undefined;
        } while (cur);
        const idx = children.findIndex(b => norm(b.id) === norm(afterId));
        if (idx >= 0) {
          const BREAK = ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'toggle', 'child_page', 'child_database'];
          let last = children[idx];
          for (let j = idx + 1; j < children.length; j++) {
            if (BREAK.includes(children[j].type)) break;
            last = children[j];
          }
          afterTarget = last.id;
          if (wantHeading) {
            const m = /^heading_(\d)$/.exec(children[idx].type || '');
            const lvl = m ? Math.min(parseInt(m[1], 10) + 1, 4) : 2;
            type = `heading_${lvl}`;
          }
        } else if (wantHeading) { type = 'heading_2'; }
      } else if (wantHeading) {
        // afterId 없음: 토글 헤딩 안(부모가 헤딩) → 부모 레벨+1, 페이지 직속 → heading_1
        let lvl = 1;
        try {
          const pr = await fetch(`https://api.notion.com/v1/blocks/${parentId}`, { headers });
          if (pr.ok) { const pb = await pr.json(); const m = /^heading_(\d)$/.exec(pb.type || ''); if (m) lvl = Math.min(parseInt(m[1], 10) + 1, 4); }
        } catch (e) {}
        type = `heading_${lvl}`;
      }

      const doAppend = async (t) => {
        // 본문(paragraph)이면 줄머리 마커를 보고 리스트/인용/체크박스 블록으로 변환
        const nb = (t === 'paragraph')
          ? (() => { const lb = lineToBlock(text || ''); return { object: 'block', type: lb.type, [lb.type]: lb.value }; })()
          : { object: 'block', type: t, [t]: { rich_text: buildRichText(text || '') } };
        const body = afterTarget ? { children: [nb], after: afterTarget } : { children: [nb] };
        return fetch(`https://api.notion.com/v1/blocks/${parentId}/children`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      };
      let r2 = await doAppend(type);
      // heading_4를 지원하지 않는 워크스페이스/통합이면 heading_3로 폴백
      if (!r2.ok && type === 'heading_4') { type = 'heading_3'; r2 = await doAppend(type); }
      if (!r2.ok) { const e = await r2.json(); return res.status(r2.status).json({ error: e.message || '추가 실패' }); }
      const data = await r2.json();
      const created = data.results?.[0];
      return res.status(200).json({ ok: true, id: (created?.id || '').replace(/-/g, ''), type });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'appendBlocks' — 여러 본문 블록을 한 번의 호출로 추가 ──────
  if (action === 'appendBlocks') {
    const { parentId, afterId, texts, blockType, exact, types, checks } = req.body;
    if (!parentId || !Array.isArray(texts)) return res.status(400).json({ error: 'parentId/texts 필요' });
    if (!texts.length) return res.status(200).json({ ok: true, ids: [] });
    const type = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4'].includes(blockType) ? blockType : 'paragraph';
    try {
      const norm = id => (id || '').replace(/-/g, '');
      let afterTarget = afterId || null;
      // exact=true면 섹션 끝까지 걷지 않고 지정한 블록 '바로 뒤'에 삽입(정밀 이동용)
      if (afterId && !exact) {
        const children = []; let cur;
        do {
          const r = await fetch(`https://api.notion.com/v1/blocks/${parentId}/children${cur ? `?start_cursor=${cur}` : ''}`, { headers });
          if (!r.ok) break;
          const d = await r.json();
          children.push(...d.results.filter(b => b?.type));
          cur = d.has_more ? d.next_cursor : undefined;
        } while (cur);
        const idx = children.findIndex(b => norm(b.id) === norm(afterId));
        if (idx >= 0) {
          const BREAK = ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'toggle', 'child_page', 'child_database'];
          let last = children[idx];
          for (let j = idx + 1; j < children.length; j++) { if (BREAK.includes(children[j].type)) break; last = children[j]; }
          afterTarget = last.id;
        }
      }
      // types[i]가 오면 그 유형 그대로 재생성 — 재정렬로 옮겨진 목록/인용/콜아웃/체크박스가
      // 문단으로 납작해지던 문제(저장 텍스트엔 줄머리 마커가 없어 lineToBlock이 못 알아봄) 해결
      const KEEP = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'heading_1', 'heading_2', 'heading_3'];
      const childrenBody = texts.map((t, i) => {
        const kt = Array.isArray(types) && KEEP.includes(types[i]) ? types[i] : null;
        if (kt) {
          const val = { rich_text: buildRichText(t || '') };
          if (kt === 'to_do') val.checked = !!(Array.isArray(checks) && checks[i]);
          return { object: 'block', type: kt, [kt]: val };
        }
        if (type === 'paragraph') { const lb = lineToBlock(t || ''); return { object: 'block', type: lb.type, [lb.type]: lb.value }; }
        return { object: 'block', type, [type]: { rich_text: buildRichText(t || '') } };
      });
      const body = afterTarget ? { children: childrenBody, after: afterTarget } : { children: childrenBody };
      const r2 = await fetch(`https://api.notion.com/v1/blocks/${parentId}/children`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!r2.ok) { const e = await r2.json(); return res.status(r2.status).json({ error: e.message || '추가 실패' }); }
      const data = await r2.json();
      const ids = (data.results || []).map(b => (b.id || '').replace(/-/g, ''));
      return res.status(200).json({ ok: true, ids });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'deleteBlock' — 블록(헤딩+하위) 삭제(보관) ──────────────
  if (action === 'deleteBlock') {
    const { blockId } = req.body;
    if (!blockId) return res.status(400).json({ error: 'blockId 필요' });
    try {
      const r = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, { method: 'DELETE', headers });
      if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || '삭제 실패' }); }
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'restoreBlock' — 삭제(보관)된 블록 복원(un-archive) ──────
  if (action === 'restoreBlock') {
    const { blockId } = req.body;
    if (!blockId) return res.status(400).json({ error: 'blockId 필요' });
    try {
      const r = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ archived: false })
      });
      if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || '복원 실패' }); }
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'pageMeta' — 페이지 last_edited_time만 가볍게 조회 ───────
  if (action === 'pageMeta') {
    const metaId = pageId || (req.body && req.body.pageId);
    if (!metaId) return res.status(400).json({ error: 'pageId 필요' });
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${metaId}`, { headers });
      if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || '조회 실패' }); }
      const d = await r.json();
      return res.status(200).json({ lastEdited: d.last_edited_time || null });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'headingNode' — 헤딩 노드 1개만 동기화 (제목 + 본문 블록) ─
  if (action === 'headingNode') {
    const { blockId, parentId } = req.body;
    if (!blockId) return res.status(400).json({ error: 'blockId 필요' });
    try {
      const br = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, { headers });
      if (!br.ok) { const e = await br.json(); return res.status(br.status).json({ error: e.message || '조회 실패' }); }
      const block = await br.json();
      const type = block.type;
      const hm = /^heading_(\d)$/.exec(type || '');
      const isToggleBlock = type === 'toggle';
      if (!hm && !isToggleBlock) return res.status(400).json({ error: '헤딩/토글 노드 아님' });
      const headObj = block[type] || {};
      const title = extractHeadingText(headObj.rich_text);
      const toggleable = isToggleBlock ? true : !!headObj.is_toggleable;
      const headingDepth = hm ? parseInt(hm[1], 10) : 2;

      const listChildren = async (id) => {
        const out = []; let cur;
        do {
          const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children${cur ? `?start_cursor=${cur}` : ''}`, { headers });
          if (!r.ok) break;
          const d = await r.json();
          out.push(...d.results.filter(b => b?.type));
          cur = d.has_more ? d.next_cursor : undefined;
        } while (cur);
        return out;
      };
      const BODY_TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout'];
      const lineOf = (b) => {
        const t = b.type;
        if (t === 'paragraph') return extractRichText(b.paragraph?.rich_text);
        if (t === 'bulleted_list_item') return '- ' + extractRichText(b.bulleted_list_item?.rich_text);
        if (t === 'numbered_list_item') return '1. ' + extractRichText(b.numbered_list_item?.rich_text);
        if (t === 'to_do') return (b.to_do?.checked ? '☑ ' : '☐ ') + extractRichText(b.to_do?.rich_text);
        if (t === 'quote') return '> ' + extractRichText(b.quote?.rich_text);
        if (t === 'callout') return extractRichText(b.callout?.rich_text);
        return null;
      };
      const body = [];
      // 본문 블록 + 그 자식(콜아웃 안·중첩 문단 등)까지 재귀로 모두 수집 — 편집 모드에서 텍스트 유실 방지.
      // (들여쓰기 시각은 생략하고 텍스트만. 헤딩·토글·하위페이지·DB는 별도 노드라 재귀에서 제외)
      const STRUCT = b => /^heading_\d$/.test(b.type) || b.type === 'toggle' || b.type === 'child_page' || b.type === 'child_database';
      const pushBlockAndKids = async (b, depth = 0) => {
        if (BODY_TYPES.includes(b.type)) {
          const line = lineOf(b);
          // type/checked를 같이 보냄 — 콜아웃은 줄머리 마커가 없어 클라이언트가 유형을 추정할 수 없고,
          // 체크 상태는 텍스트로 왕복시키면 글리프가 겹쳐 쌓인다
          if (line != null && line.trim()) body.push({
            id: b.id.replace(/-/g, ''), line, type: b.type,
            ...(b.type === 'to_do' ? { checked: !!b.to_do?.checked } : {})
          });
        }
        if (b.has_children && depth < 8 && b.type !== 'child_page' && b.type !== 'child_database') {
          for (const k of await listChildren(b.id)) {
            if (STRUCT(k)) continue;
            await pushBlockAndKids(k, depth + 1);
          }
        }
      };
      if (toggleable || isToggleBlock) {
        // 토글 헤딩/블록: 자식들이 본문
        for (const k of await listChildren(blockId)) {
          if (STRUCT(k)) continue;
          await pushBlockAndKids(k);
        }
      } else if (parentId) {
        // 일반 헤딩: 부모의 children에서 이 헤딩 다음 ~ 다음 헤딩/경계 전까지
        const sibs = await listChildren(parentId);
        const norm = s => (s || '').replace(/-/g, '');
        const idx = sibs.findIndex(b => norm(b.id) === norm(blockId));
        if (idx >= 0) {
          for (let j = idx + 1; j < sibs.length; j++) {
            const b = sibs[j];
            if (STRUCT(b)) break;
            await pushBlockAndKids(b);
          }
        }
      }
      return res.status(200).json({ title, toggleable, headingDepth, body });
    } catch (e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  if (!pageId) return res.status(400).json({ error: 'pageId 필요' });

  // 텍스트 추출 함수 — 볼드(**)·취소선(~~) 마크다운으로 보존 (본문용)
  function extractRichText(richTextArr) {
    if (!richTextArr) return '';
    return richTextArr.map(t => {
      let str = t.plain_text || '';
      if (t.annotations?.code) str = `\`${str}\``;
      if (t.annotations?.strikethrough) str = `~~${str}~~`;
      if (t.annotations?.italic) str = `*${str}*`;
      if (t.annotations?.bold) str = `**${str}**`;
      const url = t.href || t.text?.link?.url;
      if (url) str = `[${str}](${url})`; // 노션 인라인 링크 → 마크다운 링크로 보존
      return str;
    }).join('');
  }

  // 헤딩 텍스트 추출 — 볼드 무시
  function extractHeadingText(richTextArr) {
    if (!richTextArr) return '';
    // 헤딩 내부 줄바꿈(Shift+Enter)을 공백으로 합쳐 한 줄로 — 마크다운 줄 파싱에서 본문으로 새지 않게
    return richTextArr.map(t => t.plain_text || '').join('').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // 데이터베이스 하위 페이지 목록 조회
  async function fetchDatabaseChildren(dbId) {
    const pages = [];
    let cursor = undefined;
    do {
      const url = `https://api.notion.com/v1/databases/${dbId}/query`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
      });
      if (!response.ok) break;
      const data = await response.json();
      pages.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return pages;
  }

  // 페이지 타이틀 추출
  function extractPageTitle(pageData) {
    const props = pageData.properties || {};
    const titleProp = Object.values(props).find(p => p.type === 'title');
    if (titleProp?.title?.length > 0) {
      return titleProp.title.map(t => t.plain_text).join('');
    }
    if (pageData.child_page?.title) return pageData.child_page.title;
    return '(제목 없음)';
  }

  // 재귀 블록 읽기 (skipDb=true면 child_database 스킵, indent=본문 중첩 깊이)
  async function fetchBlocks(blockId, depth = 0, skipDb = false, indent = 0) {
    if (depth > 8) return '';
    const IND = '   '.repeat(indent);

    // 모든 블록을 먼저 수집 (페이지네이션 처리)
    const allBlocks = [];
    let cursor = undefined;
    do {
      const url = `https://api.notion.com/v1/blocks/${blockId}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      const data = await response.json();
      allBlocks.push(...data.results.filter(b => b?.type));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // child_database 개수에 따라 렌더 방식 결정
    const dbCount = allBlocks.filter(b => b.type === 'child_database').length;
    const useDbNodes = dbCount >= 2;

    let markdown = '';
    let listCounter = 0;

    for (const block of allBlocks) {
      try {
        const type = block.type;

        if (type === 'heading_1') {
          markdown += `${block.heading_1?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n# ` + extractHeadingText(block.heading_1?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, 0);
        } else if (type === 'heading_2') {
          markdown += `${block.heading_2?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n## ` + extractHeadingText(block.heading_2?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, 0);
        } else if (type === 'heading_3') {
          markdown += `${block.heading_3?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n### ` + extractHeadingText(block.heading_3?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, 0);
        } else if (type === 'heading_4') {
          markdown += `${block.heading_4?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n#### ` + extractHeadingText(block.heading_4?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, 0);
        } else if (type === 'paragraph') {
          const text = extractRichText(block.paragraph?.rich_text);
          if (text.trim()) markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + text + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'bulleted_list_item') {
          listCounter = 0;
          markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + '- ' + extractRichText(block.bulleted_list_item?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'numbered_list_item') {
          listCounter++;
          markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + `${listCounter}. ` + extractRichText(block.numbered_list_item?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'to_do') {
          // fetchHeadings엔 있는데 여기만 빠져 있어서 하위 페이지·DB 항목의 체크박스가 통째로 사라졌음
          listCounter = 0;
          markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + (block.to_do?.checked ? '☑ ' : '☐ ') + extractRichText(block.to_do?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'quote') {
          listCounter = 0;
          markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + '> ' + extractRichText(block.quote?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'callout') {
          listCounter = 0;
          const text = extractRichText(block.callout?.rich_text);
          // 콜아웃도 그냥 일반 텍스트로 — 박스로 안 가둠. 자식은 깊이 있게 전부 캡처(중첩 텍스트 유실 방지)
          if (text.trim()) markdown += `[BB:${block.id.replace(/-/g,'')}]\n` + IND + text + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb, indent + 1);
        } else if (type === 'toggle') {
          listCounter = 0;
          const title = extractHeadingText(block.toggle?.rich_text);
          if (title.trim()) markdown += `[TGL]\n[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n## ` + title + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1, skipDb);
          continue;
        } else if (type === 'table') {
          try {
            const tableRows = [];
            let tCursor;
            do {
              const tUrl = `https://api.notion.com/v1/blocks/${block.id}/children${tCursor ? `?start_cursor=${tCursor}` : ''}`;
              const tRes = await fetch(tUrl, { headers });
              if (!tRes.ok) break;
              const tData = await tRes.json();
              tableRows.push(...tData.results.filter(b => b.type === 'table_row'));
              tCursor = tData.has_more ? tData.next_cursor : undefined;
            } while (tCursor);
            if (tableRows.length) {
              const esc = s => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
              const rowTexts = tableRows.map(r => (r.table_row?.cells || []).map(cell => esc(extractRichText(cell))));
              const colCount = rowTexts[0].length;
              markdown += '\n| ' + rowTexts[0].join(' | ') + ' |\n';
              markdown += '|' + new Array(colCount).fill('---').join('|') + '|\n';
              for (let ri = 1; ri < rowTexts.length; ri++) markdown += '| ' + rowTexts[ri].join(' | ') + ' |\n';
            }
          } catch (e) { }
          continue;
        } else if (type === 'child_page') {
          markdown += `[CHILD_PAGE]\n[NOTION_ENTRY:${block.id.replace(/-/g,'')}]\n## ${block.child_page?.title || '하위 페이지'}\n`;
          continue;
        } else if (type === 'child_database') {
          if (skipDb) continue;
          try {
            const dbPages = await fetchDatabaseChildren(block.id);
            const BATCH = 5;

            if (useDbNodes) {
              // DB가 2개 이상: DB 이름을 중간 노드로, 하위 페이지를 그 아래에 배치
              const dbTitle = block.child_database?.title || 'Database';
              markdown += `\n[DB_NODE]\n# ${dbTitle}\n`;
              for (let i = 0; i < dbPages.length; i += BATCH) {
                const batch = dbPages.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async dbPage => {
                  const pageTitle = extractPageTitle(dbPage);
                  const pageContent = await fetchBlocks(dbPage.id, depth + 2, skipDb).catch(() => '');
                  // 페이지가 ## 레벨이므로 내부 콘텐츠는 2단계 올림
                  // # → ###, ## → ####, ### → ####, #### → ####
                  const shifted = pageContent
                    .replace(/^(\s*)#### /gm, '$1§4§ ')
                    .replace(/^(\s*)### /gm, '$1§3§ ')
                    .replace(/^(\s*)## /gm, '$1#### ')
                    .replace(/^(\s*)# /gm, '$1### ')
                    .replace(/^(\s*)§3§ /gm, '$1##### ')
                    .replace(/^(\s*)§4§ /gm, '$1##### ');
                  return `\n## ${pageTitle}\n${shifted}`;
                }));
                markdown += results.join('');
              }
            } else {
              // DB가 1개: 현재처럼 하위 페이지를 상위에 직접 연결
              for (let i = 0; i < dbPages.length; i += BATCH) {
                const batch = dbPages.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async dbPage => {
                  const pageTitle = extractPageTitle(dbPage);
                  const pageContent = await fetchBlocks(dbPage.id, depth + 2, skipDb).catch(() => '');
                  const shifted = pageContent
                    .replace(/^(\s*)#### /gm, '$1§§§§ ')
                    .replace(/^(\s*)### /gm, '$1#### ')
                    .replace(/^(\s*)## /gm, '$1### ')
                    .replace(/^(\s*)# /gm, '$1## ')
                    .replace(/^(\s*)§§§§ /gm, '$1##### ');
                  return `\n# ${pageTitle}\n${shifted}`;
                }));
                markdown += results.join('');
              }
            }
          } catch (e) { }
          continue;
        }
      } catch (e) {
        // 블록 파싱 실패 시 스킵
      }
    }

    return markdown;
  }

  // ── action: 'headings' — DB 엔트리 제목만, 본문 없이 빠르게 ────────
  if (action === 'headings') {
    try {
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
      if (!pageRes.ok) { const e = await pageRes.json(); return res.status(pageRes.status).json({ error: e.message }); }
      const pageObj = await pageRes.json();
      const pageTitle = extractPageTitle(pageObj);
      const lastEdited = pageObj.last_edited_time || null;
      // Block children cache + DB-type check cache (avoids double API calls)
      const _hCache = new Map();
      const _dbCache = new Map(); // id → db object | null
      async function _hChildren(id) {
        if (_hCache.has(id)) return _hCache.get(id);
        const blocks = [];
        let cur;
        do {
          const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children${cur ? `?start_cursor=${cur}` : ''}`, { headers });
          if (!r.ok) break;
          const d = await r.json();
          blocks.push(...d.results.filter(b => b?.type));
          cur = d.has_more ? d.next_cursor : undefined;
        } while (cur);
        _hCache.set(id, blocks);
        return blocks;
      }
      async function _checkIsDb(id) {
        if (_dbCache.has(id)) return _dbCache.get(id);
        try {
          const r = await fetch(`https://api.notion.com/v1/databases/${id}`, { headers });
          const result = r.ok ? await r.json() : null;
          _dbCache.set(id, result);
          return result;
        } catch(e) { _dbCache.set(id, null); return null; }
      }

      // Count all databases (child_database + child_page-that-is-db) across heading/toggle tree
      async function _countDbs(id, depth = 0) {
        if (depth > 5) return 0;
        const blocks = await _hChildren(id);
        let n = blocks.filter(b => b.type === 'child_database').length;
        // Check child_page blocks in parallel — some may be full-page databases
        const pageBlocks = blocks.filter(b => b.type === 'child_page');
        const pageDbResults = await Promise.all(pageBlocks.map(b => _checkIsDb(b.id)));
        n += pageDbResults.filter(Boolean).length;
        for (const b of blocks) {
          // 콜아웃 안에 DB를 넣는 경우가 있어 콜아웃도 파고든다 — 안 세면 globalUseDb가 어긋나 DB 노드가 안 생김
          if (b.has_children && /^(heading_\d|toggle|callout)$/.test(b.type)) n += await _countDbs(b.id, depth + 1);
        }
        return n;
      }

      const totalDbs = await _countDbs(pageId);
      const globalUseDb = totalDbs >= 2;

      async function fetchHeadings(blockId, depth = 0) {
        if (depth > 5) return '';
        const allBlocks = await _hChildren(blockId);
        let md = '';

        for (const block of allBlocks) {
          try {
            const type = block.type;
            if (type === 'heading_1') { md += `${block.heading_1?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n# ` + extractHeadingText(block.heading_1?.rich_text) + '\n'; if (block.has_children) md += await fetchHeadings(block.id, depth+1); }
            else if (type === 'heading_2') { md += `${block.heading_2?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n## ` + extractHeadingText(block.heading_2?.rich_text) + '\n'; if (block.has_children) md += await fetchHeadings(block.id, depth+1); }
            else if (type === 'heading_3') { md += `${block.heading_3?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n### ` + extractHeadingText(block.heading_3?.rich_text) + '\n'; if (block.has_children) md += await fetchHeadings(block.id, depth+1); }
            else if (type === 'heading_4') { md += `${block.heading_4?.is_toggleable ? '[TGL]\n' : ''}[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n#### ` + extractHeadingText(block.heading_4?.rich_text) + '\n'; if (block.has_children) md += await fetchHeadings(block.id, depth+1); }
            else if (type === 'toggle') { const t = extractHeadingText(block.toggle?.rich_text); if (t.trim()) md += `[TGL]\n[BLOCK:${block.id.replace(/-/g,'')}|${blockId.replace(/-/g,'')}]\n## ` + t + '\n'; if (block.has_children) md += await fetchHeadings(block.id, depth+1); }
            else if (type === 'child_page') {
              // Check if this page is actually a full-page database
              const dbData = await _checkIsDb(block.id); // from cache, no extra call
              if (dbData) {
                const dbTitle = dbData.title?.[0]?.plain_text || block.child_page?.title || 'Database';
                if (globalUseDb) md += `\n[DB_NODE]\n# ${dbTitle}\n`;
                try {
                  const dbPages = await fetchDatabaseChildren(block.id);
                  if (globalUseDb) {
                    for (const p of dbPages) md += `[NOTION_ENTRY:${p.id.replace(/-/g,'')}]\n## ${extractPageTitle(p)}\n`;
                  } else {
                    for (const p of dbPages) md += `[NOTION_ENTRY:${p.id.replace(/-/g,'')}]\n# ${extractPageTitle(p)}\n`;
                  }
                } catch(e) {}
              } else {
                md += `[CHILD_PAGE]\n[NOTION_ENTRY:${block.id.replace(/-/g,'')}]\n## ${block.child_page?.title || '하위 페이지'}\n`;
              }
            }
            else if (type === 'child_database') {
              const dbTitle = block.child_database?.title || 'Database';
              if (globalUseDb) md += `\n[DB_NODE]\n# ${dbTitle}\n`;
              try {
                const dbPages = await fetchDatabaseChildren(block.id);
                if (globalUseDb) {
                  for (const p of dbPages) md += `[NOTION_ENTRY:${p.id.replace(/-/g,'')}]\n## ${extractPageTitle(p)}\n`;
                } else {
                  for (const p of dbPages) md += `[NOTION_ENTRY:${p.id.replace(/-/g,'')}]\n# ${extractPageTitle(p)}\n`;
                }
              } catch(e) {}
            }
            // 본문 텍스트 블록 — [BB:] 마커로 본문으로 인식되게 (헤딩 사이 본문)
            else if (type === 'paragraph') {
              const text = extractRichText(block.paragraph?.rich_text);
              if (text.trim()) md += `[BB:${block.id.replace(/-/g,'')}]\n` + text + '\n';
            }
            else if (type === 'bulleted_list_item') {
              md += `[BB:${block.id.replace(/-/g,'')}]\n- ` + extractRichText(block.bulleted_list_item?.rich_text) + '\n';
            }
            else if (type === 'numbered_list_item') {
              md += `[BB:${block.id.replace(/-/g,'')}]\n1. ` + extractRichText(block.numbered_list_item?.rich_text) + '\n';
            }
            else if (type === 'to_do') {
              const t = extractRichText(block.to_do?.rich_text);
              if (t.trim()) md += `[BB:${block.id.replace(/-/g,'')}]\n` + (block.to_do?.checked ? '☑ ' : '☐ ') + t + '\n';
            }
            else if (type === 'quote') {
              const t = extractRichText(block.quote?.rich_text);
              if (t.trim()) md += `[BB:${block.id.replace(/-/g,'')}]\n> ` + t + '\n';
            }
            else if (type === 'callout') {
              // 콜아웃도 그냥 일반 텍스트로 — 박스 안 씌움.
              const t = extractRichText(block.callout?.rich_text);
              if (t.trim()) md += `[BB:${block.id.replace(/-/g,'')}]\n` + t + '\n';
              // fetchHeadings는 문단/리스트 자식을 재귀하지 않아 콜아웃 안 중첩 텍스트가 유실됨 →
              // fetchBlocks로 서브트리 전체를 깊이 있게 캡처(모든 텍스트 확보). skipDb는 헤딩 경로와 동일하게.
              if (block.has_children) md += await fetchBlocks(block.id, depth + 1, false, 0);
            }
          } catch(e) {}
        }
        return md;
      }

      const markdown = await fetchHeadings(pageId);
      return res.status(200).json({ title: pageTitle, markdown, useDbNodes: globalUseDb, lastEdited });
    } catch(e) { return res.status(500).json({ error: e.message || '서버 오류' }); }
  }

  // ── action: 'entry' — DB 엔트리 1개 본문 (DB 중첩 스킵) ──────────
  if (action === 'entry') {
    try {
      const markdown = await fetchBlocks(pageId, 0, true);
      return res.status(200).json({ markdown });
    } catch(e) { return res.status(200).json({ markdown: '' }); }
  }

  // ── 기본: 전체 로드 ───────────────────────────────────────────────
  try {
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
    if (!pageRes.ok) {
      const err = await pageRes.json();
      return res.status(pageRes.status).json({ error: err.message || '페이지를 찾을 수 없음. Integration이 해당 페이지에 연결되어 있는지 확인.' });
    }

    const pageData = await pageRes.json();
    const pageTitle = extractPageTitle(pageData);
    const markdown = await fetchBlocks(pageId);

    res.status(200).json({ title: pageTitle, markdown });
  } catch (e) {
    res.status(500).json({ error: e.message || '서버 오류 발생' });
  }
}
