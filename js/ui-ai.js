// ── AI (제미나이) 호출 ────────────────────────────────────────────────
// 키는 설정에서 사용자가 직접 입력(_savedAiKey). 브라우저에서 직접 호출.
const _GEMINI_MODEL = 'gemini-2.5-flash';
const _AI_WAIT = '생각하는 중… ⏳'; // 모든 진행중 표시 통일
// AI 대화가 도구 사용법 질문에도 답할 수 있게 하는 안내
const _SYNAPSE_GUIDE = `SynapseLog는 노션 페이지·마크다운(.md)을 신경망 그래프로 시각화하는 도구다.
- 노드: 페이지/헤딩이 노드가 된다. 노드를 클릭하면 우측 패널에서 제목·본문을 보고 수정할 수 있다.
- 선택: 노드를 우클릭(모바일은 더블탭)하면 다중 선택된다.
- 연결: 노드 간 연결(a→b 링크)은 선택 메뉴의 '노드 간 연결' 또는 AI 연결 추천으로 만든다.
- 검색: 좌측 레일의 검색 아이콘에서 키워드로 노드를 찾는다.
- 배치: 그래프 설정에서 힘기반/방사형/페이지별 레이아웃과 노드 색상을 바꾼다.
- 화면: 화면 맞춤, 이미지 저장 버튼이 레일 하단에 있다.
- 좌측 레일 'AI 대화'에서 '/' 명령어로 AI 기능을 쓴다:
  · /Node Summary — 선택한 노드(상위면 하위·연결 포함) 요약
  · /Node Link — 선택 노드에 연결하면 좋은 노드 추천(연결 버튼 제공)
  · /Node Edit — 선택 노드 본문을 AI가 다듬어 편집 모드로 로드
  · /Import — 웹·유튜브(자막) 링크를 마크다운으로 정리해 임시 노드로 추가
  · 노드를 선택하고 "요약해줘/연결해줘/다듬어줘"처럼 자연어로 말해도 동작한다.
  · 기본은 AI와 자유 대화(글 함께 다듬기)다. "검색해줘"라고 하면 그래프 노드를 검색해 근거로 답하고, "하위 노드에 넣어줘"라고 하면 방금 대화한 글을 선택/열린 노드의 하위 노드로 넣는다.
- 설정(⚙)에서 노션 API 토큰과 AI(구글 제미나이) API 키를 입력한다.`;
async function geminiGenerate(prompt) {
  if (!_savedAiKey) throw new Error('AI API 키가 없어 (설정에서 입력)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(_savedAiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const data = await res.json();
  const cand = data && data.candidates && data.candidates[0];
  const out = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
  if (!out.trim()) throw new Error('빈 응답 (안전 필터 차단일 수 있어)');
  return out.trim();
}

// AI 오류를 사용자용 안내 문구로 (무료 한도·키·네트워크 구분)
function _aiErrMsg(e) {
  const status = e && e.status;
  const raw = (e && e.message) || String(e || '');
  const m = raw.toLowerCase();
  if (status === 429 || /\b429\b|rate limit|quota|resource[_ ]?exhausted|too many/.test(m)) return 'AI 무료 한도(분당&하루 요청 수) 초과. 잠시 후 다시 시도.';
  if (status === 401 || status === 403 || /api[ _]?key|permission denied|invalid.*key|unauthenticated/.test(m)) return 'AI API 키 문제. 설정에서 키 다시 확인.';
  if (/failed to fetch|networkerror|network error|load failed/.test(m)) return '네트워크 오류. 연결 확인 후 다시 시도.';
  if (/빈 응답|안전 필터/.test(raw)) return 'AI 응답 생성 실패 (안전 필터일 수 있음). 다시 시도.';
  return '실패: ' + raw;
}

// AI 작업 공통 실행기 — 진행 표시 → 작업 → 실패 시 에러 메시지 + 재시도 버튼
// task는 async 함수. 내부에서 waitId로 _aiChatReplace를 직접 호출해 결과를 그린다.
function _aiRun(waitId, progressText, task) {
  const run = async () => {
    _aiChatReplace(waitId, progressText, []);
    try { await task(); }
    catch (e) { _aiChatReplace(waitId, _aiErrMsg(e), [], null, null, run); }
  };
  run();
}

// AI 키 필요 가드 — 없으면 안내 + 설정 열기. 있으면 true.
function requireAiKey() {
  if (_savedAiKey) return true;
  toast('설정에서 AI API 키 먼저 입력', { type: 'error' });
  openSettings();
  return false;
}

// AI 대화 레일 열기 (이미 열려 있으면 그대로 — openRailSection은 토글이라 중복 호출 방지)
function openAiChat() {
  if (typeof _activeRailSection !== 'undefined' && _activeRailSection === 'aichat') return;
  if (typeof openRailSection === 'function') openRailSection('aichat');
}

async function geminiSummarize(text, userText) {
  const req = (userText || '').trim();
  // 사용자가 구체 지시를 함께 넣었으면(예: "3문장으로", "표로", "핵심만") 그걸 우선 반영
  const reqLine = req ? `[사용자 지시] ${req}\n위 지시를 우선 반영해서 요약해줘.\n\n` : '';
  const prompt = `다음은 지식 그래프에서 선택한 노드들의 제목과 내용이야. 핵심만 한국어로 간결하게 요약해줘.\n- 불릿 몇 개로 정리\n- 노드 간 관계나 공통 주제가 보이면 짚어줘\n- 원문에 없는 내용은 지어내지 마\n\n${reqLine}---\n${text}`;
  return geminiGenerate(prompt);
}

// 요약 대상 확장: 자기 자신 + 구조적 하위 노드 전체 + 연결(위키/수동 링크)된 노드
function _aiExpandNodes(baseNodes) {
  const out = [], seen = new Set();
  const add = (n) => { if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); } };
  (baseNodes || []).forEach(n => {
    add(n);
    if (typeof collectSyncDescendants === 'function') collectSyncDescendants(n).forEach(add);
  });
  const inSet = new Set(out.map(n => n.id));
  (edges || []).forEach(e => {
    if ((e.wikiLink || e.manualLink) && inSet.has(e.from)) add(nodeMap[e.to]);
  });
  return out;
}

// 노드들의 내용만 모아 AI 요약 → 좌측 AI 대화창에 표시 (노션엔 저장 안 함)
// 상위 노드면 하위 전체 + 연결된 노드까지 포함해서 요약
async function aiSummarizeNodes(nodeList, userText) {
  const base = (nodeList || []).filter(Boolean);
  if (!base.length) return;
  if (!requireAiKey()) return;
  let list = _aiExpandNodes(base);
  if (list.length > 30) list = list.slice(0, 30); // 토큰 보호(상위 노드 대량 하위 대비)
  const combined = list.map(nd => {
    const title = nodeTitle(nd);
    const body = nodeBody(nd, 350);
    return body ? `## ${title}\n${body}` : `## ${title}`;
  }).join('\n\n');
  openAiChat();
  _aiChatPush('user', (userText && userText.trim()) || '/Node Summary', null, null, base);
  const waitId = _aiChatPush('ai', _AI_WAIT);
  _aiRun(waitId, _AI_WAIT, async () => {
    const summary = await geminiSummarize(combined, userText);
    _aiChatReplace(waitId, summary, list);
    if (typeof highlightAiNodes === 'function') highlightAiNodes(list);
  });
}

// 노드 하나에 대해 AI가 연결하면 좋은 관련 노드를 제안 → 대화창에 '연결' 버튼으로 표시
async function aiSuggestLinks(node, userText) {
  if (!node) return;
  if (!requireAiKey()) return;
  // 이미 연결(구조·위키)된 노드 + 자기 자신 제외
  const connected = new Set([node.id]);
  (edges || []).forEach(e => { if (e.from === node.id) connected.add(e.to); if (e.to === node.id) connected.add(e.from); });
  const query = (node.label || '') + ' ' + (node.desc || '').slice(0, 300);
  const cands = _aiSearchNodes(query, 16).filter(c => !connected.has(c.id)).slice(0, 8);
  openAiChat();
  _aiChatPush('user', (userText && userText.trim()) || '/Node Link', null, null, [node]);
  if (!cands.length) { _aiChatPush('ai', '연결할 만한 관련 노드 없음.'); return; }
  const waitId = _aiChatPush('ai', _AI_WAIT);
  const baseText = `${nodeTitle(node)}\n${nodeBody(node, 400)}`;
  const candText = cands.map((c, i) => `[${i + 1}] ${nodeTitle(c)}${c.desc ? ' — ' + c.desc.trim().slice(0, 120) : ''}`).join('\n');
  const req = (userText || '').trim();
  const reqLine = req ? `[사용자 지시] ${req} (이 관점을 고려해 고르기)\n\n` : '';
  const prompt = `기준 노드와 의미상 연결하면 좋은 후보를 골라줘. 억지로 다 고르지 말고 관련 있는 것만. 출력은 각 줄 "[번호] 이유(한 줄)" 형식으로만, 관련된 게 없으면 "없음"이라고만 해.\n\n${reqLine}[기준 노드]\n${baseText}\n\n[후보]\n${candText}`;
  _aiRun(waitId, _AI_WAIT, async () => {
    const ans = await geminiGenerate(prompt);
    const suggestions = [];
    const seen = new Set();
    ans.split('\n').forEach(line => {
      const m = line.match(/\[?\s*(\d+)\s*\]?[.)\s-]+(.*)$/);
      if (!m) return;
      const idx = parseInt(m[1], 10) - 1;
      const c = cands[idx];
      if (c && !seen.has(c.id)) { seen.add(c.id); suggestions.push({ aId: node.id, bId: c.id, targetLabel: nodeTitle(c), reason: (m[2] || '').trim() }); }
    });
    if (!suggestions.length) { _aiChatReplace(waitId, '연결할 만한 관련 노드 없음.', [], null); return; }
    _aiChatReplace(waitId, '아래 노드와 연결 추천:', [], suggestions);
    if (typeof highlightAiNodes === 'function') highlightAiNodes([node].concat(suggestions.map(s => nodeMap[s.bId]).filter(Boolean)));
  });
}

// 노드 우클릭 메뉴 → 선택 반영 후 AI 대화창 열기 (/ 명령어로 작업)
function openAiActions(nodes) {
  if (nodes && nodes.length) {
    clearMultiSelect();
    nodes.forEach(n => { if (n) { n.multiSelected = true; _multiSelected.push(n); } });
    renderMultiSelectMenu();
  }
  openAiChat();
}

// 글 다듬기: 노드 본문을 AI가 정리 → 대화창에 미리보기 + [적용](편집 열기)
async function aiRefineNode(node, userText) {
  if (!node) return;
  if (!requireAiKey()) return;
  const editable = node.local || (node.notionBlockId && node.notionParentId);
  if (!editable) { toast('이 노드는 본문 편집 불가 (노션 하위 노드만)', { type: 'error' }); return; }
  const body = (node.desc || '').trim();
  if (!body) { toast('다듬을 본문 없음', { type: 'error' }); return; }
  openAiChat();
  _aiChatPush('user', (userText && userText.trim()) || '/Node Edit', null, null, [node]);
  const waitId = _aiChatPush('ai', _AI_WAIT);
  const req = (userText || '').trim();
  const reqLine = req ? `[사용자 지시] ${req}\n위 지시를 우선 반영해 다듬어줘.\n\n` : '';
  const prompt = `다음 노드 본문을 다듬어줘. 의미는 그대로 유지하되 문법·맞춤법·문장 구조를 자연스럽고 명확하게 정리해줘. 내용을 새로 지어내거나 삭제하지 말고, 마크다운(불릿/번호) 형식은 살려줘. 다듬은 본문만 출력해(설명·머리말 없이).\n\n${reqLine}[제목] ${(node.label || '').trim()}\n[본문]\n${body.slice(0, 2000)}`;
  _aiRun(waitId, _AI_WAIT, async () => {
    const refined = (await geminiGenerate(prompt)).trim();
    _aiChatReplace(waitId, refined, [], null, { nodeId: node.id, text: refined, done: false });
  });
}

// 웹/유튜브 링크 → 서버리스로 본문·자막 추출 → 제미나이 마크다운 → 그래프 로컬 노드
async function aiImportUrl(url) {
  url = (url || '').trim();
  if (!url) { toast('/Import 뒤에 웹 주소나 유튜브 링크 입력', { type: 'error' }); return; }
  if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 링크 입력', { type: 'error' }); return; }
  if (!requireAiKey()) return;
  openAiChat();
  const isYt = /(?:youtube\.com|youtu\.be)/i.test(url);
  _aiChatPush('user', `/Import ${url}`);
  const waitId = _aiChatPush('ai', _AI_WAIT);
  _aiRun(waitId, _AI_WAIT, async () => {
    const res = await fetch('/api/extract?url=' + encodeURIComponent(url));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('추출 실패 (HTTP ' + res.status + ')'));
    const srcTitle = (data.title || '').trim() || (isYt ? '유튜브 영상' : '가져온 문서');
    const bodyText = (data.text || '').trim();
    if (!bodyText) throw new Error('내용 추출 실패 (자막 없음 / 접근 차단)');
    _aiChatReplace(waitId, _AI_WAIT, []);
    const prompt = `아래 ${isYt ? '유튜브 자막' : '웹 문서'} 내용을 한국어 마크다운으로 구조화해줘.\n[규칙]\n- 첫 줄은 "# 제목" 하나 (문서 전체 제목)\n- 주요 주제는 "## 소제목", 세부 내용은 "- 불릿"으로\n- 핵심만 간결히, 원문에 없는 내용은 지어내지 마\n- 코드블록·설명·머리말 없이 마크다운 본문만 출력\n\n[출처 제목] ${srcTitle}\n[내용]\n${bodyText.slice(0, 8000)}`;
    let md = (await geminiGenerate(prompt)).trim();
    md = md.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!md) throw new Error('마크다운 생성 결과 비어있음');
    const title = (md.match(/^#\s+(.+)$/m)?.[1] || srcTitle).trim();
    // 임시(local) 페이지로 추가 — 생성된 마크다운이라 저장 전이므로 "임시" 취급(편집·저장·내보내기 대상)
    const pageId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    mergeGraph(title, md, pageId);
    nodes.forEach(n => { if (n.sourcePageId === pageId) { n.local = true; n.visible = true; } });
    const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
    if (root) root.headingDepth = 0;
    _addedPageIds.add(pageId);
    if (typeof saveLocalPages === 'function') saveLocalPages();
    if (typeof _registerLocalInList === 'function') _registerLocalInList(pageId, title);
    if (typeof refreshSidebarRender === 'function') refreshSidebarRender();
    if (typeof updateBulkActionsVisibility === 'function') updateBulkActionsVisibility();
    isStable = false;
    _aiChatReplace(waitId, `"${title}" 임시 노드로 추가됨. (${isYt ? '자막' : '본문'} 기반 — 저장하려면 사이드바에서 내보내기)`, []);
    if (typeof fitGraph === 'function') setTimeout(() => fitGraph(true), 400);
  });
}

// ── AI 대화 (그래프 검색 기반) ────────────────────────────────────────
// 질문 → 그래프 노드 키워드 검색 → 상위 노드 텍스트만 제미나이에 넘겨 답변.
let _aiChat = [];
// 로컬 저장 모드(_useLocalStorage)일 때만 대화 기록을 localStorage에 유지 (텍스트만)
function _saveAiChat() {
  if (!_useLocalStorage) return;
  try { localStorage.setItem('snlog_aichat', JSON.stringify(_aiChat.slice(-60).map(m => ({ id: m.id, role: m.role, text: m.text })))); } catch (e) {}
}
(function _restoreAiChat() {
  try {
    if (!_useLocalStorage) return;
    const s = localStorage.getItem('snlog_aichat');
    if (!s) return;
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) _aiChat = arr.filter(m => m && m.text && !/[⏳…]/.test(m.text)).map(m => ({ id: m.id, role: m.role, text: m.text, refs: [], suggestions: null, chips: null }));
  } catch (e) {}
})();

// 불용어(질문에서 흔히 나오지만 검색 노이즈인 단어)
const _AI_STOPWORDS = new Set(['그리고','그러나','하지만','그래서','또는','대해','대한','관련','알려','알려줘','설명','설명해','정리','정리해','무엇','뭐','뭐야','뭔','뭔데','어떤','어떻게','어때','왜','언제','어디','누구','정도','그것','이것','저것','때문','통해','위해','있는','있어','없어','해줘','해','줘','좀','것','수','및','내','나','너','알고','싶어','싶은데','관해','관하여','the','a','an','of','to','is','are','and','or','what','how','why','me','my','about','please','tell','give']);
// 한국어 조사/어미 대충 제거 (3자 이상 단어에만 적용해 짧은 단어 훼손 방지)
function _aiStem(w) {
  return w.replace(/(으로부터|에서는|에게서|으로서|으로써|이라는|라는|이라고|라고|에서|에게|한테|부터|까지|처럼|보다|이나|이란|은|는|이|가|을|를|에|의|도|와|과|랑|만|나|요|로)$/, '');
}
// 질문 → 개념(단어) 목록. 각 개념은 [어간, 원형] 변형을 가짐. 불용어 컷.
// 예: "머신러닝은 알고리즘" → [['머신러닝','머신러닝은'], ['알고리즘']]
function _aiTerms(query) {
  let raw;
  try { raw = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); }
  catch (e) { raw = (query.toLowerCase().match(/[a-z0-9가-힣]+/g) || []); }
  const concepts = [];
  raw.forEach(w => {
    if (w.length < 2 || _AI_STOPWORDS.has(w)) return;
    let s = w;
    if (/[가-힣]/.test(w) && w.length >= 3) s = _aiStem(w);
    const variants = [];
    if (s.length >= 2 && !_AI_STOPWORDS.has(s)) variants.push(s);
    if (w !== s && w.length >= 2 && !_AI_STOPWORDS.has(w)) variants.push(w);
    if (variants.length) concepts.push([...new Set(variants)]);
  });
  return concepts;
}

// 질문어와 겹치는 노드 상위 topN개.
// 정렬: 맞춘 개념 수(커버리지)↑ → 점수(제목3/본문1)↑. 약한 매칭은 컷해서 엉뚱한 근거 방지.
function _aiSearchNodes(query, topN) {
  const concepts = _aiTerms(query);
  if (!concepts.length) return [];
  const total = concepts.length;
  const scored = [];
  (nodes || []).forEach(n => {
    if (n._aiSummary) return;
    const label = (n.label || '').toLowerCase(), desc = (n.desc || '').toLowerCase();
    let score = 0, coverage = 0, labelHit = false;
    concepts.forEach(vars => {
      const inLabel = vars.some(v => label.includes(v));
      const inDesc = !inLabel && vars.some(v => desc.includes(v));
      if (inLabel) { score += 3; coverage++; labelHit = true; }
      else if (inDesc) { score += 1; coverage++; }
    });
    if (coverage === 0) return;
    // 약한 매칭 컷: 질문이 2단어 이상인데 제목매치 없고 본문에 1개만 걸리면 노이즈로 버림
    if (total >= 2 && !labelHit && coverage < 2) return;
    scored.push({ n, score, coverage });
  });
  scored.sort((a, b) => (b.coverage - a.coverage) || (b.score - a.score));
  return scored.slice(0, topN).map(s => s.n);
}

// 노드칩 배경·테두리는 그래프 뷰의 해당 노드 색(nodeRgb)에 맞추고, 글자는 흰색(가독성)
function _chipColorStyle(n) {
  let rgb = [237, 112, 0];
  try { if (n && typeof nodeRgb === 'function') { const c = nodeRgb(n); if (Array.isArray(c) && c.length >= 3) rgb = c; } } catch (e) {}
  const r = rgb[0], g = rgb[1], b = rgb[2];
  return `background:rgba(${r},${g},${b},0.2);border-color:rgba(${r},${g},${b},0.6);color:#fff !important;`;
}

// ── 통합 노드칩 컴포넌트 ──────────────────────────────────────────────
// 어디서든 createNodeChip(노드 또는 노드id) 로 생성.
// depth 색 자동 · 텍스트 유동 너비 · 10글자 초과 시 말줄임(…) + 전체 텍스트 툴팁 · 클릭 시 상세 패널.
// opts.removable → 우측에 × (선택 해제용), opts.className → 추가 클래스
function createNodeChip(node, opts) {
  opts = opts || {};
  const n = (node && typeof node === 'object') ? node : (typeof nodeMap !== 'undefined' ? nodeMap[node] : null);
  if (!n) return '';
  const full = (n.label || '').trim() || '(제목 없음)';
  const maxLen = opts.maxLen || 10; // 기본 10자, 넉넉히 보여줄 곳은 opts.maxLen로 조절
  const short = full.length > maxLen ? full.slice(0, maxLen) + '…' : full;
  const x = opts.removable ? `<span class="node-chip-x" data-x="${n.id}">×</span>` : '';
  // 북마크된 노드는 칩 앞에 주황 북마크 표식(그래프의 주황 제목과 동일 의미)
  const bm = (typeof isBookmarked === 'function' && isBookmarked(n)) ? `<svg class="node-chip-bm" width="9" height="9" viewBox="0 0 24 24" fill="#ed7000" stroke="#ed7000" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>` : '';
  const cls = 'node-chip' + (opts.className ? ' ' + opts.className : '');
  return `<span class="${cls}" data-nid="${n.id}" title="${escapeHtml(full)}" style="${_chipColorStyle(n)}">${bm}<span class="node-chip-label">${escapeHtml(short)}</span>${x}</span>`;
}

// 노드칩 클릭(위임): 칩 → 상세 패널 열기, × → 선택 해제. 어디에 렌더돼도 동작.
document.addEventListener('click', (e) => {
  const x = e.target.closest('.node-chip-x');
  if (x) { e.stopPropagation(); if (typeof _deselectAiNode === 'function') _deselectAiNode(x.dataset.x); return; }
  const chip = e.target.closest('.node-chip');
  if (chip && chip.dataset.nid && typeof nodeMap !== 'undefined') {
    const n = nodeMap[chip.dataset.nid];
    if (n && typeof openPanel === 'function') openPanel(n);
  }
});

function _aiMdToHtml(t) {
  let s = escapeHtml(t || '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code class="wl-code">$1</code>');
  s = s.replace(/^(\s*)(\d+\.|-)(\s)/gm, '$1<span style="color:#ed7000;">$2</span>$3');
  return s.replace(/\n/g, '<br>');
}

function _renderAiChat() {
  const box = document.getElementById('aichat-messages');
  if (!box) return;
  if (!_aiChat.length) {
    box.innerHTML =
      `<div class="aichat-help">` +
        `<div class="aichat-help-title">AI 기능 사용에 Gemini API 키(무료) 필요</div>` +
        `<div class="aichat-help-step"><b>1.</b> <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 접속 → <b>Create API key</b> → 키 복사 </div>` +
        `<div class="aichat-help-step"><b>2.</b> 좌측 하단 <b>설정(⚙)</b> → <b>AI API 키</b> 입력 후 저장</div>` +
        `<div class="aichat-help-step"><b>3.</b> AI 대화창에서 노드 검색, 요약, 편집 가능</div>` +
      `</div>`;
    return;
  }
  box.innerHTML = _aiChat.map(m => {
    const bubbleInner = (m.chips && m.chips.length)
      ? escapeHtml(m.text) + ' ' + m.chips.map(n => createNodeChip(n)).join(' ')
      : _aiMdToHtml(m.text);
    let html = `<div class="aichat-msg ${m.role}"><div class="aichat-bubble">${bubbleInner}</div>`;
    if (m.refs && m.refs.length) {
      html += `<div class="aichat-refs"><div class="aichat-refs-label">근거</div>` + m.refs.map(n => createNodeChip(n)).join('') + `</div>`;
    }
    if (m.suggestions && m.suggestions.length) {
      html += `<div class="aichat-suggests">` + m.suggestions.map(s =>
        `<div class="aichat-suggest">` +
          `<div class="aichat-suggest-top">${createNodeChip(s.bId)}` +
          `<button class="aichat-connect-btn${s.done ? ' done' : ''}" data-a="${s.aId}" data-b="${s.bId}"${s.done ? ' disabled' : ''}>${s.done ? '연결됨' : '연결'}</button></div>` +
          (s.reason ? `<div class="aichat-suggest-reason">${escapeHtml(s.reason)}</div>` : '') +
        `</div>`).join('') + `</div>`;
    }
    if (m.refine) {
      html += `<div class="aichat-refine-actions"><button class="aichat-apply-btn${m.refine.done ? ' done' : ''}" data-mid="${m.id}"${m.refine.done ? ' disabled' : ''}>${m.refine.done ? '적용됨 (편집에서 저장)' : '적용 (편집 열기)'}</button></div>`;
    }
    if (m.retry) {
      html += `<div class="aichat-refine-actions"><button class="aichat-retry-btn" data-mid="${m.id}">↻ 다시 시도</button></div>`;
    }
    return html + `</div>`;
  }).join('');
  box.querySelectorAll('.aichat-connect-btn:not(.done)').forEach(el => {
    el.onclick = () => applyAiLink(el.dataset.a, el.dataset.b);
  });
  box.querySelectorAll('.aichat-apply-btn:not(.done)').forEach(el => {
    el.onclick = () => applyAiRefineFromMsg(el.dataset.mid);
  });
  box.querySelectorAll('.aichat-retry-btn').forEach(el => {
    el.onclick = () => { const mm = _aiChat.find(x => x.id === el.dataset.mid); if (mm && typeof mm.retry === 'function') mm.retry(); };
  });
  box.scrollTop = box.scrollHeight;
}

function _aiChatPush(role, text, refs, suggestions, chips) {
  const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
  _aiChat.push({ id, role, text, refs: refs || [], suggestions: suggestions || null, chips: chips || null });
  _renderAiChat();
  _saveAiChat();
  return id;
}
function _aiChatReplace(id, text, refs, suggestions, refine, retry) {
  const m = _aiChat.find(x => x.id === id);
  if (m) { m.text = text; m.refs = refs || []; if (suggestions !== undefined) m.suggestions = suggestions; if (refine !== undefined) m.refine = refine; m.retry = (typeof retry === 'function') ? retry : null; }
  _renderAiChat();
  _saveAiChat();
}

// AI 다듬기 '적용' → 노드를 편집 모드로 열고 다듬은 텍스트 로드(최종 저장은 사용자가 [저장])
function applyAiRefineFromMsg(mid) {
  const m = _aiChat.find(x => x.id === mid);
  if (!m || !m.refine) return;
  const node = nodeMap[m.refine.nodeId];
  if (!node) { toast('노드를 찾을 수 없음', { type: 'error' }); return; }
  openPanel(node);
  const idx = _stack.findIndex(x => x.id === node.id);
  if (idx < 0) return;
  m.refine.done = true; _renderAiChat();
  setTimeout(() => { try { beginNodeEdit(idx, node, m.refine.text); } catch (e) {} }, 90);
}

// AI 연결 제안의 '연결' 버튼 → a→b 위키 링크 생성(노션 저장은 백그라운드)
function applyAiLink(aId, bId) {
  const a = nodeMap[aId], b = nodeMap[bId];
  if (!a || !b) return;
  if (!isPairConnected(a, b)) toggleWikiConnect(a, b); // 출처가 다르면 수동 연결로 저장
  _aiChat.forEach(m => (m.suggestions || []).forEach(s => { if (s.aId === aId && s.bId === bId) s.done = true; }));
  _renderAiChat();
}

// ── AI 슬래시 명령어 (확장 가능) ─────────────────────────────────────
const _AI_COMMANDS = [
  { name: '/Node Summary', hint: '선택한 노드 요약', run: () => { if (!_multiSelected.length) { toast('노드를 먼저 선택', { type: 'error' }); return; } const ns = _multiSelected.slice(); clearMultiSelect(); aiSummarizeNodes(ns); } },
  { name: '/Node Link', hint: '선택한 노드에 대한 연결 추천', run: () => { if (_multiSelected.length !== 1) { toast('노드 1개 선택', { type: 'error' }); return; } const n = _multiSelected[0]; clearMultiSelect(); aiSuggestLinks(n); } },
  { name: '/Node Edit', hint: '선택한 노드 본문 다듬기', run: () => { if (_multiSelected.length !== 1) { toast('노드 1개 선택', { type: 'error' }); return; } const n = _multiSelected[0]; clearMultiSelect(); aiRefineNode(n); } },
  { name: '/Import', hint: '웹&유튜브(자막) 링크를 마크다운 노드로 가져오기', run: (text) => aiImportUrl(text) },
];
function _matchAiCommand(raw) {
  const lower = (raw || '').toLowerCase();
  return _AI_COMMANDS.find(c => {
    const n = c.name.toLowerCase();
    return lower === n || (lower.startsWith(n) && /\s/.test(lower.charAt(n.length)));
  });
}
// 자연어에서 노드 작업 의도 파악 (선택 노드가 있을 때만 사용) → 'summary' | 'link' | 'edit' | null
function _matchNodeIntent(raw) {
  const s = (raw || '');
  if (/요약|간추|핵심만|줄여/.test(s)) return 'summary';
  if (/다듬|고쳐|교정|매끄/.test(s)) return 'edit';
  if (/연결|링크|이어|연관|관련\s*노드/.test(s)) return 'link';
  return null;
}
// 명령어 메뉴는 body에 붙여 fixed로 띄운다 (사이드바 overflow/transform에 안 잘리게)
let _aiCmdMenuEl = null, _aiCmdItems = [], _aiCmdSel = 0;
function _renderAiCmdSel() {
  if (!_aiCmdMenuEl) return;
  _aiCmdMenuEl.querySelectorAll('.ai-cmd-item').forEach((el, i) => el.classList.toggle('sel', i === _aiCmdSel));
  const cur = _aiCmdMenuEl.querySelector('.ai-cmd-item.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function _aiCmdMenuOutside(e) {
  const btn = document.getElementById('aichat-cmd');
  if (_aiCmdMenuEl && !_aiCmdMenuEl.contains(e.target) && !(btn && btn.contains(e.target))) _closeAiCmdMenu();
}
function _closeAiCmdMenu() {
  if (_aiCmdMenuEl) { document.removeEventListener('mousedown', _aiCmdMenuOutside); _aiCmdMenuEl.remove(); _aiCmdMenuEl = null; }
}
function _hideAiCmdMenu() { _closeAiCmdMenu(); }
function _showAiCmdMenu(list) {
  _closeAiCmdMenu();
  if (!list || !list.length) return;
  const bar = document.querySelector('.aichat-input-row') || document.querySelector('.aichat-bar');
  if (!bar) return;
  const menu = document.createElement('div');
  menu.className = 'aichat-cmd-menu';
  _aiCmdItems = list; _aiCmdSel = 0;
  menu.innerHTML = list.map((c, i) => `<button class="ai-cmd-item${i === 0 ? ' sel' : ''}" data-i="${i}" data-cmd="${escapeHtml(c.name)}"><span class="ai-cmd-name">${escapeHtml(c.name)}</span><span class="ai-cmd-hint">${escapeHtml(c.hint)}</span></button>`).join('');
  document.body.appendChild(menu);
  const r = bar.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.width = r.width + 'px';
  menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  // 바 위쪽 여유공간에 높이를 맞춰서, 넘치면 화면 밖으로 잘리지 않고 스크롤되게
  menu.style.maxHeight = Math.max(120, Math.min(r.top - 14, window.innerHeight * 0.5)) + 'px';
  menu.querySelectorAll('.ai-cmd-item').forEach(el => {
    el.onmousedown = (e) => { e.preventDefault(); _pickAiCommand(el.dataset.cmd); };
    el.onmouseenter = () => { _aiCmdSel = +el.dataset.i; _renderAiCmdSel(); };
  });
  _aiCmdMenuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', _aiCmdMenuOutside), 0);
}
function toggleAiCmdMenu() {
  if (_aiCmdMenuEl) { _closeAiCmdMenu(); return; }
  _showAiCmdMenu(_AI_COMMANDS);
}
function _pickAiCommand(name) {
  const cmd = _AI_COMMANDS.find(c => c.name === name);
  _closeAiCmdMenu();
  if (cmd && cmd.name.indexOf('/Node') === 0) { _enterCmdMode(cmd); return; }
  const input = document.getElementById('aichat-input');
  if (input) { input.value = name + ' '; input.focus(); _autoGrowAiInput(input); }
}
function _autoGrowAiInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 72) + 'px';
}
// 노드 명령어를 입력란 안의 pill로 표시하고 그 옆에 선택 노드칩 (/Node Edit [노드칩])
let _aiActiveCmd = null;
function _enterCmdMode(cmd) {
  _aiActiveCmd = cmd;
  const input = document.getElementById('aichat-input');
  if (input) { input.value = ''; input.placeholder = ''; _autoGrowAiInput(input); input.focus(); }
  _closeAiCmdMenu();
  _renderAiTokens();
}
function _exitCmdMode() {
  _aiActiveCmd = null;
  const input = document.getElementById('aichat-input');
  if (input) input.placeholder = (typeof t === 'function' ? t('ai-chat-ph') : '') || '키워드 입력하여 AI와 대화 시작';
  _renderAiTokens();
}
function _renderAiTokens() {
  const box = document.getElementById('aichat-tokens');
  if (!box) return;
  const input = document.getElementById('aichat-input');
  const nodes = _multiSelected || [];
  if (!_aiActiveCmd && !nodes.length) {
    box.innerHTML = ''; box.style.display = 'none';
    if (input && !_aiActiveCmd) input.placeholder = (typeof t === 'function' ? t('ai-chat-ph') : '') || '키워드 입력하여 AI와 대화 시작';
    return;
  }
  let html = _aiActiveCmd ? `<span class="aichat-cmd-pill">${escapeHtml(_aiActiveCmd.name)}</span>` : '';
  html += nodes.map(n => createNodeChip(n, { removable: true })).join('');
  box.innerHTML = html;
  box.style.display = 'flex';
  if (input) input.placeholder = ''; // 칩·명령어 있으면 안내문 숨김
}
// 입력란 노드칩의 X → 그 노드 선택 해제
function _deselectAiNode(id) {
  const idx = _multiSelected.findIndex(n => n.id === id);
  if (idx >= 0) { if (_multiSelected[idx]) _multiSelected[idx].multiSelected = false; _multiSelected.splice(idx, 1); }
  if (typeof renderMultiSelectMenu === 'function') renderMultiSelectMenu();
  isStable = false;
}
// AI 입력(textarea)에서 '[' → 노드 자동완성. 선택하면 그 노드를 대화에 첨부(칩)
function _aiWikiQueryAt(ta) {
  if (!ta || ta.selectionStart == null || ta.selectionStart !== ta.selectionEnd) return null;
  const pos = ta.selectionStart;
  const m = ta.value.slice(0, pos).match(/\[([^\[\]\n]*)$/);
  if (!m) return null;
  return { start: pos - m[0].length, end: pos, query: m[1] };
}
function _updateAiWikiMenu(ta) {
  if (typeof nodes === 'undefined') { _hideWikiMenu(); return; }
  const q = _aiWikiQueryAt(ta);
  if (!q) { _hideWikiMenu(); return; }
  const query = q.query.trim().toLowerCase();
  let cands = nodes.filter(n => n.visible && n.label && n.label.trim());
  if (query) cands = cands.filter(n => n.label.toLowerCase().includes(query));
  cands.sort((a, b) => {
    const as = a.label.toLowerCase().startsWith(query) ? 0 : 1, bs = b.label.toLowerCase().startsWith(query) ? 0 : 1;
    return as - bs || a.label.length - b.label.length;
  });
  cands = cands.slice(0, 8);
  if (!cands.length) { _hideWikiMenu(); return; }
  _wikiItems = cands; _wikiSel = 0; _wikiRow = ta;
  const menu = _ensureWikiMenu();
  menu.innerHTML = cands.map((n, i) => {
    const ctx = _wikiCtxLabel(n);
    return `<div class="wl-item${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="wl-label">${_wikiEsc(n.label)}</span>${ctx ? `<span class="wl-ctx">${_wikiEsc(ctx)}</span>` : ''}</div>`;
  }).join('');
  menu.querySelectorAll('.wl-item').forEach(el => {
    el.addEventListener('mousedown', e => { e.preventDefault(); _wikiSel = +el.dataset.i; _applyAiWikiSelection(ta); });
  });
  menu.style.display = 'block';
  const r = ta.getBoundingClientRect();
  const mw = menu.offsetWidth || 200, mh = menu.offsetHeight || 200;
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
  menu.style.top = Math.max(8, r.top - mh - 6) + 'px'; // 입력란이 하단이라 위로 띄움
}
function _applyAiWikiSelection(ta) {
  const q = _aiWikiQueryAt(ta), n = _wikiItems[_wikiSel];
  if (!q || !n) { _hideWikiMenu(); return; }
  ta.value = ta.value.slice(0, q.start) + ta.value.slice(q.end); // '[query' 트리거 제거
  ta.setSelectionRange(q.start, q.start);
  if (typeof _autoGrowAiInput === 'function') _autoGrowAiInput(ta);
  if (!_multiSelected.some(x => x.id === n.id)) { _multiSelected.push(n); n.multiSelected = true; }
  if (typeof _renderAiTokens === 'function') _renderAiTokens();
  isStable = false;
  _hideWikiMenu();
  ta.focus();
}
function onAiKeydown(e) {
  const input = e.target;
  if (_wikiMenu && _wikiMenu.style.display !== 'none' && _wikiRow === input) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _wikiSel = Math.min(_wikiSel + 1, _wikiItems.length - 1); _renderWikiSel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _wikiSel = Math.max(_wikiSel - 1, 0); _renderWikiSel(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); _applyAiWikiSelection(input); return; }
    if (e.key === 'Escape') { e.preventDefault(); _hideWikiMenu(); return; }
  }
  if (_aiCmdMenuEl && _aiCmdItems.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _aiCmdSel = Math.min(_aiCmdSel + 1, _aiCmdItems.length - 1); _renderAiCmdSel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _aiCmdSel = Math.max(_aiCmdSel - 1, 0); _renderAiCmdSel(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const c = _aiCmdItems[_aiCmdSel]; if (c) _pickAiCommand(c.name); return; }
    if (e.key === 'Escape') { e.preventDefault(); _closeAiCmdMenu(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiChat(); return; }
  if (e.key === 'Backspace' && _aiActiveCmd && !input.value) { e.preventDefault(); _exitCmdMode(); }
}
function onAiInput(el) {
  _autoGrowAiInput(el);
  _updateAiWikiMenu(el);
  const v = el.value || '';
  const trimmed = v.trim();
  const exact = _AI_COMMANDS.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (exact && exact.name.indexOf('/Node') === 0) { _enterCmdMode(exact); return; }
  if (v.startsWith('/')) {
    const q = v.toLowerCase().trim();
    const list = _AI_COMMANDS.filter(c => c.name.toLowerCase().startsWith(q));
    if (list.length) _showAiCmdMenu(list); else _closeAiCmdMenu();
  } else _closeAiCmdMenu();
}

// 질문 → Gemini 1차 호출로 검색용 핵심 키워드(+유사어) 추출. 실패하면 원 질문 그대로.
async function _aiExtractKeywords(query) {
  const q = (query || '').trim();
  if (q.length < 3) return q; // 아주 짧으면 추출 생략(비용/의미 없음)
  try {
    const prompt = `다음 질문에서 지식 그래프 노드 검색에 쓸 핵심 키워드만 뽑아줘.\n[규칙]\n- 조사·동사·불필요어(대해, 생각, 알려줘, 설명, 정리 등) 제거\n- 핵심 명사 위주로\n- 동의어/유사어가 있으면 함께 (예: 인간 → 인간, 사람 / AI → AI, 인공지능)\n- 쉼표로 구분한 키워드만 출력 (문장·설명·따옴표 금지)\n\n질문: ${q}`;
    const out = (await geminiGenerate(prompt)).trim();
    const kws = out.split(/[\n,·、]/).map(s => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    if (!kws.length) return q;
    return kws.join(' ');
  } catch (e) {
    return q; // 1차 실패 시 원 질문으로 폴백
  }
}

async function sendAiChat() {
  const input = document.getElementById('aichat-input');
  // pill 모드(노드 명령어)면 선택 노드로 실행
  if (_aiActiveCmd) {
    const cmd = _aiActiveCmd;
    _exitCmdMode();
    if (input) { input.value = ''; _autoGrowAiInput(input); }
    _hideAiCmdMenu();
    cmd.run('');
    return;
  }
  const q = (input && input.value || '').trim();
  if (!q) return;
  // 슬래시 명령어면 해당 모드로 라우팅 (AI가 명령어 인식)
  const cmd = _matchAiCommand(q);
  if (cmd) {
    const rest = q.slice(cmd.name.length).trim();
    if (input) { input.value = ''; _autoGrowAiInput(input); }
    _hideAiCmdMenu();
    cmd.run(rest);
    return;
  }
  // 노드가 선택돼 있고 자연어에 의도(요약/연결/다듬기)가 담겨 있으면 → 선택 노드로 해당 작업 실행
  if (_multiSelected.length >= 1) {
    const intent = _matchNodeIntent(q);
    if (intent) {
      if (input) { input.value = ''; _autoGrowAiInput(input); }
      _hideAiCmdMenu();
      if (intent === 'summary') { const ns = _multiSelected.slice(); clearMultiSelect(); aiSummarizeNodes(ns, q); return; }
      if (_multiSelected.length !== 1) { toast('이 작업은 노드 1개만 선택', { type: 'error' }); return; }
      const n = _multiSelected[0]; clearMultiSelect();
      if (intent === 'link') aiSuggestLinks(n, q); else aiRefineNode(n, q);
      return;
    }
  }
  if (!requireAiKey()) return;
  if (input) { input.value = ''; _autoGrowAiInput(input); }
  // 저장: 대화하며 만든 글을 하위 노드로 넣기 ("하위노드에 넣어줘")
  if (/하위\s*노드|자식\s*노드|노드에?\s*넣|노드로\s*(넣|만들|저장)|하위로\s*넣/.test(q)) { aiSaveToChild(q); return; }
  // 검색: 명시적으로 요청할 때만 그래프 RAG ("검색해줘")
  if (/검색|관련\s*노드|그래프에서|노드\s*(찾|검색)/.test(q)) { _aiAnswerRAG(q); return; }
  // 기본: 일반 대화 (이전 맥락 이어서 글을 함께 발전)
  _aiConverse(q);
}

// 일반 대화 — 그래프 검색 없이 이전 맥락을 이어서 답(글 함께 다듬기)
function _aiConverse(q) {
  const sel = (_multiSelected || []).slice();
  const hist = _aiChat
    .filter(m => m.text && !/[⏳]/.test(m.text) && !/^실패|다시 시도|넣는 중|넣음/.test(m.text))
    .slice(-8)
    .map(m => (m.role === 'user' ? '사용자' : '조수') + ': ' + m.text).join('\n');
  const nodeCtx = sel.map(n => `## ${nodeTitle(n)}\n${nodeBody(n, 600)}`).join('\n\n');
  _aiChatPush('user', q, null, null, sel.length ? sel : null);
  if (sel.length && typeof clearMultiSelect === 'function') clearMultiSelect();
  const waitId = _aiChatPush('ai', _AI_WAIT);
  _aiRun(waitId, _AI_WAIT, async () => {
    const prompt = `너는 사용자와 대화하며 생각·글을 함께 다듬는 조수야. 한국어로 자연스럽게 이어서 대화하고, 필요하면 글을 발전시켜 제안해줘.\n(지식 그래프 노드 "검색"은 사용자가 검색을 요청할 때만 한다. 지금은 일반 대화다.)${nodeCtx ? '\n\n[사용자가 첨부한 노드]\n' + nodeCtx : ''}${hist ? '\n\n[이전 대화]\n' + hist : ''}\n\n[사용자]\n${q}`;
    const ans = await geminiGenerate(prompt);
    _aiChatReplace(waitId, ans, []);
  });
}

