// ── Notion 클라이언트 & 페이지 관리 ────────────────────────────────

let _savedToken = _decKey(sessionStorage.getItem('snlog_token')) || _decKey(localStorage.getItem('snlog_token')) || '';
let _addedPageIds = new Set();

// ── 로컬 폴더 동기화 (File System Access API, Chrome/Edge) ────────────

function _idbOpen() {
  if (!_useLocalStorage) return Promise.reject(new Error('로컬 저장 사용이 꺼져있어요'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('synapselog_db', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _idbSave(store, rec) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
async function _idbGetAll(store) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
}
async function _idbDelete(store, id) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
const _idbSaveFolder = rec => _idbSave('folders', rec);
const _idbGetAllFolders = () => _idbGetAll('folders');

async function _walkDirectory(dirHandle, relPath = '') {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const path = relPath ? `${relPath}/${name}` : name;
    if (handle.kind === 'file') { if (/\.(md|txt)$/i.test(name)) files.push({ path, handle }); }
    else if (handle.kind === 'directory') { files.push(...await _walkDirectory(handle, path)); }
  }
  return files;
}

// ── 개별 .MD 파일 동기화 (File System Access API) ──────────────────────

function pickMdFile() {
  if (window.showOpenFilePicker) pickMdFileViaFSA();
  else document.getElementById('md-import-file').click();
}

async function _importMdFileHandle(handle, pageId) {
  const file = await handle.getFile();
  const text = await file.text();
  const title = file.name.replace(/\.md$|\.txt$/i, '');
  pageId = pageId || ('md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  mergeGraph(title, text, pageId);
  _addedPageIds.add(pageId);
  sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown: text, isMd: true, hasHandle: true, _cachedAt: Date.now() }));
  return { pageId, title, lastModified: file.lastModified };
}

async function pickMdFileViaFSA() {
  let handles;
  try { handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.txt'] } }] }); } catch(e) { return; }
  if (!window._mdFileHandles) window._mdFileHandles = new Map();
  for (const handle of handles) {
    const { pageId, title, lastModified } = await _importMdFileHandle(handle);
    window._mdFileHandles.set(pageId, { handle, lastModified });
    try { await _idbSave('files', { id: pageId, handle, lastModified }); } catch(e) {}
    const wrap = document.getElementById('sidebar-page-list-wrap');
    if (wrap) wrap.style.display = 'block';
    if (!window._sidebarPageList) window._sidebarPageList = [];
    window._sidebarPageList.push({ id: pageId, title, isMd: true, hasHandle: true });
  }
  refreshSidebarRender(); updateBulkActionsVisibility(); savePageList();
}

async function loadMdFileHandles() {
  if (!window.showOpenFilePicker) return;
  try {
    const recs = await _idbGetAll('files');
    if (!window._mdFileHandles) window._mdFileHandles = new Map();
    recs.forEach(r => window._mdFileHandles.set(r.id, { handle: r.handle, lastModified: r.lastModified }));
  } catch(e) {}
}

async function syncMdFile(pageId) {
  const info = window._mdFileHandles?.get(pageId);
  if (!info) return;
  try {
    let perm = await info.handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await info.handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return;
    const file = await info.handle.getFile();
    if (file.lastModified === info.lastModified) return;
    const removeIds = new Set(nodes.filter(n => n.sourcePageId === pageId).map(n => n.id));
    nodes = nodes.filter(n => !removeIds.has(n.id));
    edges = edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to));
    Object.keys(nodeMap).forEach(k => { if (removeIds.has(k)) delete nodeMap[k]; });
    const { lastModified } = await _importMdFileHandle(info.handle, pageId);
    info.lastModified = lastModified;
    await _idbSave('files', { id: pageId, handle: info.handle, lastModified });
    refreshSidebarRender();
  } catch(e) {}
}

async function syncMdFileHandles() {
  if (!window._mdFileHandles || window._mdFileHandles.size === 0) return;
  for (const pageId of [...window._mdFileHandles.keys()]) { await syncMdFile(pageId); }
  refreshSidebarRender(); updateBulkActionsVisibility(); savePageList();
}

function pickFolder() {
  if (window.showDirectoryPicker) pickFolderViaFSA();
  else document.getElementById('md-import-folder').click();
}

async function _saveFolderBatchToIDB(folderBatchId) {
  const batch = window._folderBatches?.get(folderBatchId);
  if (!batch) return;
  try { await _idbSaveFolder({ id: folderBatchId, handle: batch.handle, name: batch.name, files: [...batch.files.entries()] }); } catch(e) {}
}

async function _importFolderFile(path, handle, folderBatchId, pageId) {
  const file = await handle.getFile();
  const text = await file.text();
  const title = file.name.replace(/\.md$|\.txt$/i, '');
  pageId = pageId || ('md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  mergeGraph(title, text, pageId);
  _addedPageIds.add(pageId);
  sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown: text, isMd: true, folderBatchId, relPath: path, _cachedAt: Date.now() }));
  return { pageId, lastModified: file.lastModified };
}

async function pickFolderViaFSA() {
  let dirHandle;
  try { dirHandle = await window.showDirectoryPicker(); } catch(e) { return; }
  const folderBatchId = 'mdfolder_' + Date.now();
  const entries = await _walkDirectory(dirHandle);
  const files = new Map();
  for (const { path, handle } of entries) { const r = await _importFolderFile(path, handle, folderBatchId); files.set(path, r); }
  if (!window._folderBatches) window._folderBatches = new Map();
  window._folderBatches.set(folderBatchId, { handle: dirHandle, name: dirHandle.name, files });
  await _saveFolderBatchToIDB(folderBatchId);
  renderMdFolderList(); updateBulkActionsVisibility(); savePageList();
}

async function loadFolderBatches() {
  if (!window.showDirectoryPicker) return;
  try {
    const recs = await _idbGetAllFolders();
    if (!window._folderBatches) window._folderBatches = new Map();
    recs.forEach(r => window._folderBatches.set(r.id, { handle: r.handle, name: r.name, files: new Map(r.files) }));
    renderMdFolderList();
  } catch(e) {}
}

async function _syncOneFolderBatch(folderBatchId, batch) {
  let perm = await batch.handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') perm = await batch.handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') return;
  const entries = await _walkDirectory(batch.handle);
  const seenPaths = new Set();
  for (const { path, handle } of entries) {
    seenPaths.add(path);
    const existing = batch.files.get(path);
    if (!existing) {
      const r = await _importFolderFile(path, handle, folderBatchId);
      batch.files.set(path, r);
    } else {
      const file = await handle.getFile();
      if (file.lastModified !== existing.lastModified) {
        const removeIds = new Set(nodes.filter(n => n.sourcePageId === existing.pageId).map(n => n.id));
        nodes = nodes.filter(n => !removeIds.has(n.id));
        edges = edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to));
        Object.keys(nodeMap).forEach(k => { if (removeIds.has(k)) delete nodeMap[k]; });
        const r = await _importFolderFile(path, handle, folderBatchId, existing.pageId);
        batch.files.set(path, r);
      }
    }
  }
  for (const [path, info] of [...batch.files]) {
    if (!seenPaths.has(path)) {
      removePage(info.pageId, document.querySelector(`[data-page-id="${info.pageId}"]`));
      batch.files.delete(path);
    }
  }
  await _saveFolderBatchToIDB(folderBatchId);
}

async function syncFolderBatch(folderBatchId) {
  const batch = window._folderBatches?.get(folderBatchId);
  if (!batch) return;
  try { await _syncOneFolderBatch(folderBatchId, batch); } catch(e) {}
  renderMdFolderList(); updateBulkActionsVisibility(); savePageList();
}

async function syncFolderBatches() {
  if (!window._folderBatches || window._folderBatches.size === 0) return;
  for (const [folderBatchId, batch] of window._folderBatches) {
    try { await _syncOneFolderBatch(folderBatchId, batch); } catch(e) {}
  }
  renderMdFolderList(); updateBulkActionsVisibility(); savePageList();
}

function renderMdFolderList() {
  const wrap = document.getElementById('md-folder-list-wrap');
  const listEl = document.getElementById('md-folder-list');
  if (!wrap || !listEl) return;
  if (!window._folderBatches || window._folderBatches.size === 0) { wrap.style.display = 'none'; listEl.innerHTML = ''; return; }
  wrap.style.display = 'block';
  listEl.innerHTML = [...window._folderBatches.entries()].map(([folderBatchId, batch]) => {
    const files = [...batch.files.entries()];
    return `<div class="md-folder-group" data-folder-id="${folderBatchId}">
      <div class="md-folder-header">
        <span class="md-folder-name" title="${escapeHtml(batch.name || '폴더')}"><svg class="md-folder-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> ${escapeHtml(batch.name || '폴더')} <span style="color:rgba(237,112,0,0.55);font-size:9px;">${files.length}개</span></span>
        <div class="item-actions"><button title="이 폴더 동기화" onclick="syncFolderBatch('${folderBatchId}')">↻</button><button title="폴더 전체 제거" onclick="removeFolderBatch('${folderBatchId}')">✕</button></div>
      </div>
      <div class="md-folder-files">
        ${files.map(([path, info]) => `<div class="md-folder-file" data-page-id="${info.pageId}">
          <span class="item-label" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
          <button class="btn-remove" onclick="removePage('${info.pageId}', this.closest('.md-folder-file'))">✕</button>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

async function removeFolderBatch(folderBatchId) {
  const batch = window._folderBatches?.get(folderBatchId);
  if (!batch) return;
  for (const [, info] of [...batch.files]) { removePage(info.pageId, document.querySelector(`[data-page-id="${info.pageId}"]`)); }
  window._folderBatches.delete(folderBatchId);
  try { await _idbDelete('folders', folderBatchId); } catch(e) {}
  renderMdFolderList(); updateBulkActionsVisibility(); savePageList();
}

async function notionFetch(body) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: _savedToken, ...body })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('서버 응답 오류'); }
  if (!res.ok) throw new Error(data.error || '오류가 발생했어요');
  return data;
}

// ── 노션 쓰기: 블록 텍스트 수정 ──────────────────────────────────────

async function notionUpdateBlock(blockId, text) {
  return notionFetch({ action: 'updateBlock', blockId, text });
}

async function notionAppendBlock(parentId, afterId, text, blockType) {
  return notionFetch({ action: 'appendBlock', parentId, afterId, text, blockType });
}

// 여러 블록을 한 번의 호출로 추가 → ['id', ...] 배열 반환 (순서 보존)
// exact=true면 afterId 블록 '바로 뒤'에 정밀 삽입(섹션 끝으로 안 밀림) — 최소 이동용
async function notionAppendBlocks(parentId, afterId, texts, blockType, exact) {
  const res = await notionFetch({ action: 'appendBlocks', parentId, afterId, texts, blockType, exact: !!exact });
  return (res && res.ids) || [];
}

async function notionDeleteBlock(blockId) {
  return notionFetch({ action: 'deleteBlock', blockId });
}

async function notionRestoreBlock(blockId) {
  return notionFetch({ action: 'restoreBlock', blockId });
}

// 쓰기/삭제 후 해당 노드가 속한 세션 캐시를 버린다 → 다음 새로고침 때 노션에서 새로 받아옴
// (예전엔 캐시 마크다운을 정규식으로 직접 수술했지만, 형식 불일치 버그가 잦아 무효화 방식으로 단순화)
function invalidateNodeCache(node) {
  if (!node) return;
  const pid = node.sourcePageId;
  if (pid && !String(pid).startsWith('local_') && !String(pid).startsWith('md_')) {
    try { sessionStorage.removeItem('snlog_' + pid); } catch (e) {}
  }
  // 엔트리(하위 페이지/DB 항목) 안의 노드면 그 엔트리 캐시도 버림
  let cur = node, guard = 0;
  while (cur && guard++ < 40) {
    if (cur.entryNotionId) { try { sessionStorage.removeItem('snlog_entry_' + cur.entryNotionId); } catch (e) {} break; }
    const pe = (typeof edges !== 'undefined') ? edges.find(e => e.to === cur.id && !e.weakLink) : null;
    cur = pe ? nodeMap[pe.from] : null;
  }
}

// ── 로컬 노드(노션과 무관, 로컬 저장) + 마크다운 내보내기 ──────────────

// 노드의 하위 트리를 마크다운으로 직렬화 (depth: 자식 헤딩 레벨 시작값)
function serializeChildrenMd(nodeId, depth) {
  let md = '';
  edges.filter(e => e.from === nodeId && !e.weakLink && !e.manualLink).forEach(e => {
    const c = nodeMap[e.to];
    if (!c) return;
    md += '#'.repeat(Math.min(depth, 6)) + ' ' + c.label + '\n';
    if (c.desc && c.desc !== '(내용 없음)') md += c.desc.replace(/\n+$/, '') + '\n';
    md += serializeChildrenMd(c.id, depth + 1);
  });
  return md;
}

// 로컬 노드 트리를 localStorage에 저장 (새로고침해도 유지)
function saveLocalPages() {
  try {
    const roots = nodes.filter(n => n.local && n.level === 0);
    const pages = roots.map(r => ({ pageId: r.sourcePageId, title: r.label, desc: r.desc || '', markdown: serializeChildrenMd(r.id, 1) }));
    localStorage.setItem('snlog_local_pages', JSON.stringify(pages));
  } catch (e) {}
}

function restoreLocalPages() {
  let pages;
  try { pages = JSON.parse(localStorage.getItem('snlog_local_pages') || '[]'); } catch (e) { return; }
  for (const p of pages) {
    if (!p.pageId || _addedPageIds.has(p.pageId)) continue;
    mergeGraph(p.title || '새 노드', '', p.pageId);
    const root = nodes.find(n => n.sourcePageId === p.pageId && n.level === 0);
    if (!root) continue;
    root.local = true; root.visible = true; root.desc = p.desc || ''; root.headingDepth = 0;
    if (p.markdown) {
      const ids = _addEntryChildNodes(root, p.markdown);
      ids.forEach(id => { const c = nodeMap[id]; if (c) { c.local = true; c.visible = true; } });
    }
    _addedPageIds.add(p.pageId);
    _registerLocalInList(p.pageId, p.title || '새 노드');
  }
  refreshSidebarRender();
  isStable = false;
}

function _registerLocalInList(pageId, title) {
  if (!window._sidebarPageList) window._sidebarPageList = [];
  if (!window._sidebarPageList.some(p => p.id === pageId)) {
    window._sidebarPageList.push({ id: pageId, title, isLocal: true });
  }
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'block';
}

function createLocalRoot(title) {
  const pageId = 'local_' + Date.now();
  mergeGraph(title || '새 노드', '', pageId);
  const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
  if (root) { root.local = true; root.visible = true; root.headingDepth = 0; }
  _addedPageIds.add(pageId);
  saveLocalPages();
  _registerLocalInList(pageId, title || '새 노드');
  refreshSidebarRender();
  isStable = false;
  if (root && typeof openPanel === 'function') openPanel(root);
  return root;
}

function newLocalRoot() {
  const inp = document.getElementById('new-root-input');
  const t = inp ? inp.value.trim() : '';
  if (!t) { if (inp) inp.focus(); return; }
  createLocalRoot(t);
  if (inp) inp.value = '';
}

function focusLocalRoot(pageId) {
  const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
  if (root && typeof openPanel === 'function') { openPanel(root); highlightSidebarPage(pageId); }
}

// 노드 하위 트리를 .md 파일로 내보내기
function exportNodeMarkdown(node) {
  let md = '# ' + node.label + '\n';
  if (node.desc && node.desc !== '(내용 없음)') md += node.desc.replace(/\n+$/, '') + '\n';
  md += serializeChildrenMd(node.id, 2);
  const safe = (node.label || 'export').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 60).trim() || 'export';
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.download = safe + '.md';
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportPageById(pageId) {
  const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
  if (root) exportNodeMarkdown(root);
  else alert('내보낼 내용을 찾지 못했어요. 페이지를 먼저 불러오거나 열어주세요.');
}

// ── 로그인/페이지 선택 ───────────────────────────────────────────────

// 설정 없이 바로 둘러보는 샘플 그래프 — .MD 임포트와 동일 경로라 별도 처리 불필요
const _SAMPLE_MD = `# 노트 샘플

이 노드는 샘플입니다. 노션 없이 기능을 그대로 사용해볼 수 있습니다.

## 화면 조작

**마우스 휠** -> 확대·축소
**좌클릭 드래그** -> 이동
**우클릭 드래그** -> 화면 회전
**빈 공간 더블 클릭** -> 화면 맞춤

## 노드 사용

**노드 좌클릭** -> 노드 상세 보기
**노드 우클릭(모바일: 더블탭)** -> 노드 선택 툴(연결·북마크·삭제 등)
**Ctrl+클릭** -> 노드 고정

## 좌측 아이콘

### 페이지 목록

- 페이지 목록 보기
- 최상위 노드 생성
- MD파일(폴더) 불러오기

### 노드

- **북마크:** 북마크 노드 모음
- **최근 본 노드:** 클릭한 노드 기록
- **중심 노드:** 하위 연결이 많은 노드를 표시
- **연결 제안:** 키워드 연관성에 따라 연결을 제안

### 그래프 설정

- **노드 색상**(노드별, 깊이별)
- **그래프 배치**(힘기반, 방사형(Radial Tree), 페이지별)
- **그래프 설정:** (노드 반발력 슬라이더, 중력, 노드 크기, 링크 선 두께, 제목 글자 크기)

### 검색

- 키워드 검색 기능

### AI

- /Node Summary: 단일 또는 복수 노드 요약
- /Node Link: 노드 연결 추천 기능
- /Node Edit: 선택한 노드 본문 다듬기
- /import: 웹&유튜브(자막) 링크를 마크다운 노드로 가져오기
- AI 키워드 검색 요약 기능

### 범례

기호, 도구, AI에 대한 상세 설명

### 화면맞춤

### 이미지 저장

- 이미지 크기: 1024x1024px / 2048x2048px / 4096x4096px

### 설정

#### 언어 / LANGUAGE

앱 UI 언어 변경

#### 저장 & 캐시

1. 로컬 저장 변경
2. Notion API & AI API 입력 및 삭제
3. 캐시 삭제

#### 키보드 단축키

1. 버튼 클릭 후 원하는 키 입력

## 노드 선택 툴(우클릭/모바일: 더블 클릭)

### 하위 노드 추가

- 현재 노드의 하위에 종속적인 노드를 추가

### 노드 동기화

- 여러 장치(PC, 태블릿, 스마트폰 등), 또는 다른 사용자들과 함께 작업할 때 노드 정보(내용, 연결 관계, 속성 등)를 최신 상태로 유지하고 일관성을 보장하는 기능

### 노션에서 보기

- 선택한 노드와 연결된 노션 페이지를 노션에서 바로 열기

### 북마크

- 특정 노드를 '즐겨찾기'처럼 표시하여 나중에 쉽고 빠르게 찾아볼 수 있도록 저장

### 노드 삭제

- **노션에도 반영되니 주의**
- 더 이상 필요 없는 정보, 잘못 생성된 노드, 또는 프로젝트가 완료되어 보관할 필요가 없는 노드를 정리할 때 사용합니다.
- **주의사항:** 노드 삭제 시 해당 노드에 연결된 다른 노드들과의 관계(링크)가 어떻게 처리될지, 노드 안에 저장된 콘텐츠는 어떻게 되는지 확인해야 합니다. 대부분의 경우 연결된 링크도 함께 삭제되거나, 삭제 전에 사용자에게 확인을 요청합니다.

### 노드 연결

- 현재 노드에서 다른 노드로 새로운 링크(관계)를 생성 혹은 해제

### 포커스 모드

- 특정 노드(또는 선택한 노드 그룹)에 집중하도록 주변 노드를 흐리게 처리해 시각적 복잡함을 줄이는 기능

### 경로 찾기

- 두 개의 특정 노드(시작 노드와 끝 노드) 사이에 존재하는 연결 경로를 찾아주는 기능

### 위성 모드

- 기존 그래프 형식에서 떼어내 하위 노드와 함께 외곽으로 밀어냅니다.

### 노드 고정

- 선택한 노드의 위치를 캔버스 상에 고정`;

function startWithSample() {
  document.getElementById('login-screen').style.display = 'none';
  buildGraph(); loop();
  const title = '샘플 노트', pageId = 'md_sample_' + Date.now();
  setTimeout(() => {
    mergeGraph(title, _SAMPLE_MD, pageId);
    _addedPageIds.add(pageId);
    sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown: _SAMPLE_MD, isMd: true, _cachedAt: Date.now() }));
    const wrap = document.getElementById('sidebar-page-list-wrap');
    if (wrap) wrap.style.display = 'block';
    if (!window._sidebarPageList) window._sidebarPageList = [];
    window._sidebarPageList.push({ id: pageId, title, isMd: true });
    refreshSidebarRender();
    updateBulkActionsVisibility(); savePageList();
    setTimeout(() => { try { fitGraph(true); } catch (e) {} }, 700);
  }, 100);
}

function startWithMd(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('login-screen').style.display = 'none';
    buildGraph(); loop();
    const markdown = e.target.result;
    const title = file.name.replace(/\.md$|\.txt$/i, '');
    const pageId = 'md_' + Date.now();
    setTimeout(() => {
      mergeGraph(title, markdown, pageId);
      _addedPageIds.add(pageId);
      sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown, isMd: true, _cachedAt: Date.now() }));
      const wrap = document.getElementById('sidebar-page-list-wrap');
      if (wrap) wrap.style.display = 'block';
      if (!window._sidebarPageList) window._sidebarPageList = [];
      window._sidebarPageList.push({ id: pageId, title, isMd: true });
      refreshSidebarRender();
      updateBulkActionsVisibility(); savePageList();
    }, 100);
  };
  reader.readAsText(file); event.target.value = '';
}

async function startGraph() {
  const token = document.getElementById('input-token').value.trim();
  const errEl = document.getElementById('login-error');
  if (!token) { errEl.textContent = 'Notion API Token을 입력해주세요'; errEl.style.display = 'block'; return; }
  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
    errEl.textContent = '올바른 토큰 형식이 아니에요 (secret_ 또는 ntn_ 으로 시작)';
    errEl.style.display = 'block'; return;
  }
  _savedToken = token;
  try { sessionStorage.setItem('snlog_token', token); } catch(e) {}
  if (_useLocalStorage) { try { localStorage.setItem('snlog_token', token); } catch(e) {} }
  errEl.style.display = 'none';
  showPagePicker();
}

async function showPagePicker() {
  const loginBox = document.getElementById('login-box');
  loginBox.innerHTML = `
    <div class="login-title">Synapse<span>Log</span></div>
    <div class="login-sub" style="margin-bottom:14px;">불러올 페이지를 선택하세요</div>
    <div style="position:relative; margin-bottom:10px;">
      <input type="text" id="page-search-input" autocomplete="off" placeholder="페이지 검색..." style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:9px 12px; font-size:13px; font-family:inherit; color:#fff; outline:none; transition:border-color 0.2s;" oninput="filterPageList(this.value)" onfocus="this.style.borderColor='rgba(237,112,0,0.5)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"/>
    </div>
    <div id="page-list" style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
      <div style="text-align:center; color:rgba(255,255,255,0.3); font-size:12px; padding:20px 0;">불러오는 중...</div>
    </div>
    <div style="display:flex; gap:8px;">
      <button onclick="startWithSelected()" style="flex:1; background:rgba(237,112,0,0.15); border:1px solid rgba(237,112,0,0.4); border-radius:8px; padding:11px; color:#ed7000; font-size:13px; font-weight:700; font-family:inherit; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(237,112,0,0.25)'" onmouseout="this.style.background='rgba(237,112,0,0.15)'">선택한 페이지 불러오기</button>
      <button onclick="skipToGraph()" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:11px 14px; color:rgba(255,255,255,0.5); font-size:13px; font-weight:700; font-family:inherit; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.09)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">건너뛰기</button>
    </div>
    <div id="page-pick-error" style="font-size:12px; color:#ff6b6b; text-align:center; margin-top:8px; display:none;"></div>
  `;
  try {
    const data = await notionFetch({ action: 'list' });
    window._pageList = data.pages || [];
    renderPageList(window._pageList);
  } catch(e) {
    document.getElementById('page-list').innerHTML = `<div style="text-align:center; color:#ff6b6b; font-size:12px; padding:16px 0;">${e.message}</div>`;
  }
}

window._selectedPageIds = new Set();

function renderPageList(pages) {
  const list = document.getElementById('page-list');
  if (!list) return;
  if (pages.length === 0) { list.innerHTML = _emptyPagesHtml(false); return; }
  // 사이드바 목록과 동일하게 상위/하위를 트리 순서 + 들여쓰기 가이드로 표시
  const ordered = _orderPagesByHierarchy(pages.filter(p => p.title && p.title.trim()));
  list.innerHTML = ordered.map((row, i) => row.p.isDatabase ? `
    <div class="${_pliRowClass(ordered, i)}" style="--d:${row.depth}">
      <div class="page-pick-item is-db">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(row.p.title) || '(제목 없음)'}</span>
        <span class="node-chip node-chip--badge db-badge">DB</span>
      </div>
    </div>
  ` : `
    <div class="${_pliRowClass(ordered, i)}" style="--d:${row.depth}">
      <div class="page-pick-item" data-id="${row.p.id}" onclick="togglePageSelect('${row.p.id}', this)"
        style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); cursor:pointer; transition:background 0.15s; font-size:13px; color:rgba(255,255,255,0.75);">
        <div style="width:16px; height:16px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s;" class="pick-check"></div>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(row.p.title) || '(제목 없음)'}</span>
      </div>
    </div>
  `).join('');
}

function togglePageSelect(pageId, el) {
  if (window._selectedPageIds.has(pageId)) {
    window._selectedPageIds.delete(pageId);
    el.style.background = 'rgba(255,255,255,0.04)'; el.style.borderColor = 'rgba(255,255,255,0.08)';
    el.querySelector('.pick-check').style.background = '';
    el.querySelector('.pick-check').style.borderColor = 'rgba(255,255,255,0.25)';
    el.querySelector('.pick-check').innerHTML = '';
  } else {
    window._selectedPageIds.add(pageId);
    el.style.background = 'rgba(237,112,0,0.1)'; el.style.borderColor = 'rgba(237,112,0,0.35)';
    el.querySelector('.pick-check').style.background = '#ed7000';
    el.querySelector('.pick-check').style.borderColor = '#ed7000';
    el.querySelector('.pick-check').innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="2,5 4,7 8,3" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
}

function filterPageList(query) {
  if (!window._pageList) return;
  const filtered = query.trim() ? window._pageList.filter(p => p.title.toLowerCase().includes(query.toLowerCase())) : window._pageList;
  renderPageList(filtered);
}

async function startWithSelected() {
  if (window._selectedPageIds.size === 0) {
    const errEl = document.getElementById('page-pick-error');
    if (errEl) { errEl.textContent = '페이지를 하나 이상 선택해주세요'; errEl.style.display = 'block'; }
    return;
  }
  document.getElementById('login-screen').style.display = 'none';
  buildGraph(); loop();
  setTimeout(restoreLocalPages, 200);
  setTimeout(initSidebarPageList, 300); setTimeout(loadProfile, 500);
  for (const pageId of window._selectedPageIds) { await addPageById(pageId); }
}

function skipToGraph() {
  document.getElementById('login-screen').style.display = 'none';
  buildGraph(); loop();
  setTimeout(restoreLocalPages, 200);
  setTimeout(initSidebarPageList, 300); setTimeout(loadProfile, 500);
}

// ── 사이드바 페이지 목록 ─────────────────────────────────────────────

async function initSidebarPageList() {
  if (!_savedToken) return;
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'block';
  await refreshSidebarPageList();
}

async function refreshSidebarPageList() {
  if (!_savedToken) return;
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="font-size:11px; color:rgba(255,255,255,0.25); padding:6px 0; text-align:center;">불러오는 중...</div>';
  try {
    const data = await notionFetch({ action: 'list' });
    const pages = data.pages || [];
    // 로컬/MD 항목은 노션 목록에 없으므로 보존
    const extras = (window._sidebarPageList || []).filter(p => (p.isLocal || p.isMd) && !pages.some(q => q.id === p.id));
    window._sidebarPageList = pages.concat(extras);
    renderSidebarPageList(window._sidebarPageList);
  } catch(e) {
    listEl.innerHTML = `<div style="font-size:11px; color:#ff6b6b; padding:6px 0; text-align:center;">${e.message}</div>`;
  }
}

function renderSidebarPageList(pages) {
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return;
  if (!pages || !pages.length) { listEl.innerHTML = _emptyPagesHtml(true); return; }
  const ordered = _orderPagesByHierarchy([...pages].filter(p => p.title && p.title.trim()));
  listEl.innerHTML = ordered.map((row, i) => `<div class="${_pliRowClass(ordered, i)}" style="--d:${row.depth}">${_pageItemHtml(row.p)}</div>`).join('');
}

// 목록이 비는 가장 흔한 원인은 '통합을 페이지에 연결' 누락 — 원인과 해결을 같이 안내
function _emptyPagesHtml(compact) {
  return `<div class="pages-empty${compact ? ' compact' : ''}">
    <div class="pe-title">연결된 페이지 없음</div>
    <div class="pe-desc">노션에서 통합을 연결한 페이지만 목록에 나타납니다.</div>
    <ol class="pe-steps">
      <li>노션에서 원하는 페이지 열기</li>
      <li>우측 상단 <b>···</b> → <b>연결</b></li>
      <li>발급 때 만든 <b>integration</b> 선택</li>
    </ol>
    <a class="pe-link" href="https://www.notion.so/my-integrations" target="_blank" rel="noopener">통합 관리 열기</a>
  </div>`;
}

// 들여쓰기 가이드 클래스 — 같은 깊이가 연속된 구간의 처음/끝을 '[' 처럼 꺾기 위한 표시
function _pliRowClass(ordered, i) {
  const depth = ordered[i].depth;
  if (!depth) return 'pli-row';
  const prev = ordered[i - 1], next = ordered[i + 1];
  let cls = 'pli-row pli-child';
  if (!prev || prev.depth < depth) cls += ' pli-first';
  if (!next || next.depth < depth) cls += ' pli-last';
  return cls;
}

// 상위/하위 페이지를 트리 순서로 정렬하고 깊이를 매김 (부모가 목록에 없으면 최상위로 취급)
function _orderPagesByHierarchy(pages) {
  const byId = new Map(pages.map(p => [p.id, p]));
  const children = new Map();
  const roots = [];
  pages.forEach(p => {
    const par = (p.parentId && p.parentId !== p.id && byId.has(p.parentId)) ? p.parentId : null;
    if (par) { if (!children.has(par)) children.set(par, []); children.get(par).push(p); }
    else roots.push(p);
  });
  const cmp = (a, b) => {
    const fa = _favoritePageIds.has(a.id) ? 0 : 1, fb = _favoritePageIds.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (a.title || '').localeCompare(b.title || '', 'ko', { numeric: true });
  };
  const out = [], seen = new Set();
  const walk = (p, depth) => {
    if (seen.has(p.id)) return; // 순환 방어
    seen.add(p.id);
    out.push({ p, depth });
    (children.get(p.id) || []).sort(cmp).forEach(k => walk(k, depth + 1));
  };
  // 부모가 목록에 없어도(통합이 상위 페이지에 미연결) 하위 페이지·DB 항목이면 한 단계 들여씀
  const baseDepth = p => (p.parentType === 'page_id' || p.parentType === 'database_id') ? 1 : 0;
  // 최상위 페이지를 먼저 배치(각각 자기 하위를 바로 아래 달고 감) → 상위가 항상 하위 맨 위에 옴
  roots.filter(r => !baseDepth(r)).sort(cmp).forEach(r => walk(r, 0));
  // 부모를 목록에서 못 찾은 하위들은 같은 부모끼리 묶어서 뒤에 배치(최상위들 사이에 흩어지지 않게)
  const orphanGroups = new Map();
  roots.filter(r => baseDepth(r) && !seen.has(r.id)).forEach(r => {
    const k = r.parentId || '';
    if (!orphanGroups.has(k)) orphanGroups.set(k, []);
    orphanGroups.get(k).push(r);
  });
  [...orphanGroups.values()]
    .map(g => g.sort(cmp))
    .sort((a, b) => cmp(a[0], b[0]))
    .forEach(g => g.forEach(r => walk(r, 1)));
  pages.forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); out.push({ p, depth: 0 }); } }); // 누락 방어
  return out;
}

function _pageItemHtml(p) {
  {
    const isActive = _addedPageIds.has(p.id);
    const isFav = _favoritePageIds.has(p.id);
    let mdBadge = '';
    if (p.isMd || p.isLocal) {
      const rootN = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes.find(nd => nd.level === 0 && nd.sourcePageId === p.id) : null;
      const txt = p.isMd ? 'MD' : '임시';
      const style = (rootN && typeof _chipColorStyle === 'function')
        ? _chipColorStyle(rootN)
        : (p.isMd ? 'background:rgba(237,112,0,0.14);border-color:rgba(237,112,0,0.4);color:#ed7000;'
                  : 'background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);');
      mdBadge = ` <span class="node-chip node-chip--badge" style="${style}">${txt}</span>`;
    }
    const starBtn = `<button class="btn-favorite${isFav ? ' active' : ''}" title="즐겨찾기" onclick="event.stopPropagation();toggleFavorite('${p.id}')">${isFav ? '★' : '☆'}</button>`;
    const exportBtn = `<button class="btn-sync" title="마크다운 내보내기" onclick="event.stopPropagation();exportPageById('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>`;
    const safeTitle = escapeHtml(p.title) || '(제목 없음)';
    // 데이터베이스는 하위 항목의 부모 자리를 잡아주는 표시용 행 (추가 대상 아님)
    if (p.isDatabase) {
      return `<div class="page-list-item is-db" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}">${safeTitle}<span class="node-chip node-chip--badge db-badge">DB</span></span>
      </div>`;
    }
    if (p.isLocal) {
      return `<div class="page-list-item active" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}" onclick="focusPage('${p.id}')">${safeTitle}${mdBadge}</span>
        <div class="item-actions">
          ${starBtn}
          ${exportBtn}
          <button class="btn-remove" onclick="event.stopPropagation();confirmRemoveLocalPage('${p.id}')">✕</button>
        </div>
      </div>`;
    }
    if (isActive) {
      return `<div class="page-list-item active" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}" onclick="focusPage('${p.id}')">${safeTitle}${mdBadge}</span>
        <div class="item-actions">
          ${starBtn}
          ${exportBtn}
          ${p.isMd ? (p.hasHandle ? `<button class="btn-sync" title="동기화" onclick="event.stopPropagation();syncMdFile('${p.id}')">↻</button>` : '') : `<button class="btn-sync" title="동기화" onclick="event.stopPropagation();syncPage('${p.id}')">↻</button>`}
          <button class="btn-remove" onclick="removePage('${p.id}', document.querySelector('[data-page-id=\\'${p.id}\\']'))">✕</button>
        </div>
      </div>`;
    } else {
      return `<div class="page-list-item" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}" onclick="addPageById('${p.id}')">${safeTitle}</span>
        <div class="item-actions">${starBtn}</div>
      </div>`;
    }
  }
}

function refreshSidebarRender() {
  if (window._sidebarPageList) renderSidebarPageList(window._sidebarPageList);
}

function highlightSidebarPage(pageId) {
  document.querySelectorAll('.page-list-item.focused').forEach(el => el.classList.remove('focused'));
  if (!pageId) return;
  const normalId = pageId.replace(/-/g, '');
  const el = [...document.querySelectorAll('.page-list-item[data-page-id]')]
    .find(el => el.dataset.pageId.replace(/-/g, '') === normalId);
  if (el) { el.classList.add('focused'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// ── 페이지 추가/동기화/제거 ──────────────────────────────────────────

async function addPageById(pageId) {
  if (_addedPageIds.has(pageId)) return;
  showLoading('노션 페이지 불러오는 중...');
  try {
    const cacheKey = `snlog_${pageId}`;
    let data;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { try { data = JSON.parse(cached); } catch(e) {} }
    if (!data) {
      data = await notionFetch({ pageId, action: 'headings' });
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    }
    _addedPageIds.add(pageId);
    mergeGraph(data.title || '추가 페이지', data.markdown || '', pageId);
    updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
    _loadEntriesBackground(pageId);
  } catch(e) {} finally { hideLoading(); }
}

async function addPage() {
  const raw = document.getElementById('add-page-id').value.trim();
  const pageId = (raw.match(/([a-f0-9]{32})/i)?.[1] || raw.replace(/-/g, '')).toLowerCase();
  const errEl = document.getElementById('add-page-error');
  const btn = document.getElementById('add-page-submit-btn');
  if (!pageId) { errEl.textContent = 'Page ID를 입력해주세요'; errEl.style.display = 'block'; return; }
  if (_addedPageIds.has(pageId)) { errEl.textContent = '이미 추가된 페이지예요'; errEl.style.display = 'block'; return; }
  if (!_savedToken) { errEl.textContent = '토큰 정보가 없어요. 새로고침 후 다시 시도해주세요'; errEl.style.display = 'block'; return; }
  if (btn) { btn.style.pointerEvents = 'none'; btn.style.opacity = '0.4'; }
  errEl.style.display = 'none';
  showLoading('노션 페이지 불러오는 중...');
  try {
    const cacheKey = `snlog_${pageId}`;
    const cached = sessionStorage.getItem(cacheKey);
    let data;
    if (cached) { try { data = JSON.parse(cached); setLoadingText('캐시에서 불러오는 중...'); } catch(e) { data = null; } }
    if (!data) {
      data = await notionFetch({ pageId, action: 'headings' });
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    }
    _addedPageIds.add(pageId);
    mergeGraph(data.title || '추가 페이지', data.markdown || '', pageId);
    const list = document.getElementById('added-pages-list');
    const item = document.createElement('div');
    item.className = 'added-page-item'; item.dataset.pageId = pageId;
    const isCached = !!cached && !JSON.parse(cached)._headingsOnly;
    item.innerHTML = `<span>📄 ${escapeHtml(data.title || pageId)}${isCached ? ' <span style="color:rgba(237,112,0,0.5);font-size:9px;">캐시</span>' : ''}</span><div class="btn-group"><button class="btn-sync" title="동기화" onclick="syncPage('${pageId}')">↻</button><button class="btn-remove" onclick="removePage('${pageId}', this.closest('.added-page-item'))">✕</button></div>`;
    list.appendChild(item);
    updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
    _loadEntriesBackground(pageId);
    document.getElementById('add-page-id').value = '';
    isStable = false;
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  } finally {
    hideLoading();
    if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
  }
}

function savePageList() {
  const list = [];
  _addedPageIds.forEach(pageId => {
    if (pageId.startsWith('local_')) return; // 로컬 노드는 snlog_local_pages로 따로 저장
    const cached = sessionStorage.getItem(`snlog_${pageId}`);
    const title = cached ? (JSON.parse(cached).title || pageId) : pageId;
    list.push({ pageId, title });
  });
  // 'pages' 스코프로 저장 → 로컬 저장 켜져 있으면 localStorage에 남아 F5·재시작에도 페이지 목록 복원(노드 위치는 저장 안 함)
  snSet('snlog_pages', JSON.stringify(list), 'pages');
}

async function restorePageList() {
  const saved = snGet('snlog_pages', 'pages');
  if (!saved) return;
  let list; try { list = JSON.parse(saved); } catch(e) { return; }
  for (const { pageId, title } of list) {
    if (_addedPageIds.has(pageId)) continue;
    const cached = sessionStorage.getItem(`snlog_${pageId}`);
    let data;
    if (cached) { try { data = JSON.parse(cached); } catch(e) {} }
    if (!data) {
      if (pageId.startsWith('md_')) continue;
      try {
        data = await notionFetch({ pageId, action: 'headings' });
        sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() }));
      } catch(e) { continue; }
    }
    _addedPageIds.add(pageId);
    await mergeGraph(data.title || title, data.markdown || '', pageId);
    if (data.isMd || pageId.startsWith('md_')) {
      if (!data.folderBatchId) {
        const wrap = document.getElementById('sidebar-page-list-wrap');
        if (wrap) wrap.style.display = 'block';
        if (!window._sidebarPageList) window._sidebarPageList = [];
        window._sidebarPageList.push({ id: pageId, title: data.title || title, isMd: true, hasHandle: !!data.hasHandle });
      }
    } else {
      _loadEntriesBackground(pageId);
    }
  }
  refreshSidebarRender();
  renderMdFolderList();
  updateBulkActionsVisibility();
}

// 엔트리(DB/하위페이지) 노드의 하위 트리만 제거 — 엔트리 노드 자체는 보존.
// 수동 동기화 시 _loadEntriesBackground가 새로 만들기 전에 호출해 중복 생성 방지.
function _clearEntryDescendants(pageId) {
  const entryDesc = new Set();
  const q = nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId).map(n => n.id);
  const seen = new Set(q);
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => {
      if (e.from === id && !e.weakLink && !e.manualLink && !seen.has(e.to)) {
        seen.add(e.to); entryDesc.add(e.to); q.push(e.to);
      }
    });
  }
  if (entryDesc.size) {
    nodes = nodes.filter(n => !entryDesc.has(n.id));
    edges = edges.filter(e => !entryDesc.has(e.from) && !entryDesc.has(e.to));
    entryDesc.forEach(id => delete nodeMap[id]);
  }
  return entryDesc;
}

async function syncPage(pageId, opts) {
  opts = opts || {};
  const item = document.querySelector(`[data-page-id="${pageId}"]`);
  const syncBtn = item?.querySelector('.btn-sync');
  if (syncBtn) syncBtn.textContent = '⟳';
  if (!opts.silent) showLoading('동기화 중...');
  try {
    // 수동 동기화만 엔트리 캐시까지 새로고침 (자동 폴링은 가볍게 헤딩만)
    if (!opts.silent) {
      nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId)
           .forEach(n => sessionStorage.removeItem(`snlog_entry_${n.entryNotionId}`));
    }
    const data = await notionFetch({ pageId, action: 'headings' });
    try { sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    // ghost(미로드 placeholder) 노드 제거
    const ghostId = 'ghost_' + pageId;
    if (nodeMap[ghostId]) { nodes = nodes.filter(n => n.id !== ghostId); edges = edges.filter(e => e.from !== ghostId && e.to !== ghostId); delete nodeMap[ghostId]; }
    // 증분 동기화 — 기존 노드 위치/탭 유지, 변경분만 반영
    const removed = syncPageIncremental(data.title || '추가 페이지', data.markdown || '', pageId);
    if (removed && removed.size && typeof pruneDetailTabs === 'function') pruneDetailTabs(removed);
    if (syncBtn) syncBtn.textContent = '↻';
    if (!opts.silent) {
      // 기존 엔트리 하위 노드 제거 후 새로 로드 → 중복·구조변경 미반영 방지
      const cleared = _clearEntryDescendants(pageId);
      if (cleared.size && typeof pruneDetailTabs === 'function') pruneDetailTabs(cleared);
      if (typeof refreshOpenPanes === 'function') refreshOpenPanes();
      _loadEntriesBackground(pageId);
    } else if (typeof refreshOpenPanes === 'function') refreshOpenPanes();
  } catch(e) { if (syncBtn) syncBtn.textContent = '↻'; } finally { if (!opts.silent) hideLoading(); }
}


function confirmRemoveLocalPage(pageId) {
  const el = document.querySelector(`[data-page-id="${pageId}"]`);
  const page = (window._sidebarPageList || []).find(p => p.id === pageId);
  const title = (page && page.title) ? page.title : '이 페이지';
  showConfirm('임시 페이지 삭제', `'${title}'을(를) 삭제할까요?\n임시(로컬) 페이지는 복구할 수 없어요.`, () => removePage(pageId, el), true);
}

function removePage(pageId, el) {
  _addedPageIds.delete(pageId);
  if (el) el.remove();
  const removeIds = new Set(nodes.filter(n => n.sourcePageId === pageId || n.id === 'ghost_' + pageId).map(n => n.id));
  nodes = nodes.filter(n => !removeIds.has(n.id));
  edges = edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to));
  Object.keys(nodeMap).forEach(k => { if (removeIds.has(k)) delete nodeMap[k]; });
  if ((pageId.startsWith('md_') || pageId.startsWith('local_')) && window._sidebarPageList) window._sidebarPageList = window._sidebarPageList.filter(p => p.id !== pageId);
  if (pageId.startsWith('local_')) saveLocalPages();
  if (window._folderBatches) {
    for (const [folderBatchId, batch] of window._folderBatches) {
      for (const [path, info] of batch.files) {
        if (info.pageId === pageId) { batch.files.delete(path); _saveFolderBatchToIDB(folderBatchId); break; }
      }
    }
  }
  if (window._mdFileHandles && window._mdFileHandles.has(pageId)) {
    window._mdFileHandles.delete(pageId);
    _idbDelete('files', pageId).catch(()=>{});
  }
  isStable = false; updateBulkActionsVisibility(); savePageList(); refreshSidebarRender(); renderMdFolderList();
}

function updateBulkActionsVisibility() {
  const bulk = document.getElementById('bulk-actions');
  if (bulk) bulk.style.display = _addedPageIds.size > 0 ? 'flex' : 'none';
}

let _confirmCallback = null;
function showConfirm(title, msg, onOk, accent) {
  const t = document.getElementById('confirm-title');
  t.textContent = title;
  t.style.color = accent ? '#ed7000' : '';
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.add('open');
  _confirmCallback = onOk;
  document.getElementById('confirm-ok').onclick = () => { closeConfirm(); onOk(); };
}
function closeConfirm() { document.getElementById('confirm-modal').classList.remove('open'); _confirmCallback = null; }

function confirmBulkSync() { showConfirm('전체 동기화', '모든 페이지의 노션 데이터를 새로 불러옵니다. 계속할까요?', bulkSync); }
async function bulkSync() {
  const ids = [..._addedPageIds].filter(pid => !pid.startsWith('md_') && !pid.startsWith('local_'));
  for (const pid of ids) { await syncPage(pid); }
  await syncMdFileHandles();
  await syncFolderBatches();
  await refreshSidebarPageList(); // 노션 페이지 목록도 갱신(새 페이지 반영)
}
function confirmBulkClose() {
  showConfirm('전체 닫기', '추가된 모든 페이지 노드를 제거합니다. 계속할까요?', () => {
    const ids = [..._addedPageIds];
    ids.forEach(pid => { const el = document.querySelector(`[data-page-id="${pid}"]`); removePage(pid, el); });
    document.getElementById('bulk-actions').style.display = 'none';
  });
}

// ── 엔트리 백그라운드 로드 ───────────────────────────────────────────

function _addEntryChildNodes(entryNode, markdown) {
  const lines = markdown.split('\n');
  const prefix = 'ec' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_';
  let nid = 0;
  const newIds = new Set();
  const currentParents = { 0: entryNode.id };
  let pendingIsChildPage = false;
  let pendingEntryId = null;
  let pendingBlockId = null;
  let pendingParentId = null;
  let pendingToggle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('---')) continue;
    if (line === '[TGL]') { pendingToggle = true; continue; }
    if (line === '[CHILD_PAGE]') { pendingIsChildPage = true; continue; }
    const entryMarker = line.match(/^\[NOTION_ENTRY:([a-f0-9]+)\]$/);
    if (entryMarker) { pendingEntryId = entryMarker[1]; continue; }
    const blockMarker = line.match(/^\[BLOCK:([a-f0-9]+)(?:\|([a-f0-9]+))?\]$/);
    if (blockMarker) { pendingBlockId = blockMarker[1]; pendingParentId = blockMarker[2] || null; continue; }
    const headerMatch = line.match(/^(#{1,5})\s+(.*)$/);
    if (!headerMatch) { pendingIsChildPage = false; pendingEntryId = null; pendingBlockId = null; pendingParentId = null; pendingToggle = false; continue; }

    const mdDepth = Math.min(headerMatch[1].length, 5);
    const graphLevel = Math.min(entryNode.level + mdDepth, 5);
    let lbl = headerMatch[2].trim().replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');

    let parentId = entryNode.id;
    for (let d = mdDepth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }

    let descLines = [], bodyBlocks = [], curBlk = null, nextIdx = i + 1;
    const flushBlk = () => { if (curBlk) { bodyBlocks.push({ id: curBlk.id, text: curBlk.lines.join('\n') }); curBlk = null; } };
    while (nextIdx < lines.length) {
      const rawNl = lines[nextIdx].replace(/\s+$/, '');
      const nl = rawNl.trim();
      if (!nl) { nextIdx++; continue; }
      if (nl.startsWith('#') || nl === '[CHILD_PAGE]' || nl === '[TGL]' || nl.startsWith('[NOTION_ENTRY:') || nl.startsWith('[BLOCK:')) break;
      const bbm = nl.match(/^\[BB:([a-f0-9]+)\]$/);
      if (bbm) { flushBlk(); curBlk = { id: bbm[1], lines: [] }; nextIdx++; continue; }
      if (descLines.join('\n').length > 3000) { nextIdx++; continue; }
      descLines.push(rawNl);
      if (curBlk) curBlk.lines.push(bodyBlockText(rawNl));
      nextIdx++;
    }
    flushBlk();

    const parentColor = nodeMap[parentId]?.color;
    let color = null;
    if (graphLevel === 1) { color = getH1Color(lbl); }
    else if (graphLevel === 2) {
      if (parentColor) {
        const sibCnt = edges.filter(e => e.from === parentId).length;
        color = hslColor((extractHue(parentColor) + (sibCnt * 47) % 120 - 60 + 360) % 360, 70, 58);
      }
    } else if (graphLevel === 3) {
      if (parentColor) color = hslColor(extractHue(parentColor), 65, 62);
    } else if (graphLevel === 4) {
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 55);
    } else if (graphLevel === 5) {
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 48);
    }

    const id = prefix + (nid++);
    const n = {
      id, label: cleanLabel(lbl), desc: cleanDesc(descLines.join('\n').substring(0, 5000)), date: '',
      x: entryNode.x + (Math.random()-0.5)*50, y: entryNode.y + (Math.random()-0.5)*50,
      vx: 0, vy: 0, level: graphLevel, fixed: false, color,
      _rgb: hexToRgb(color || '#74b9ff'),
      sourcePageId: entryNode.sourcePageId, visible: false, _frozen: false, _frozenFrames: 0
    };
    if (pendingEntryId) { n.entryNotionId = pendingEntryId; pendingEntryId = null; }
    if (pendingBlockId) { n.notionBlockId = pendingBlockId; n.notionParentId = pendingParentId; pendingBlockId = null; pendingParentId = null; }
    if (pendingToggle) { n.notionToggle = true; pendingToggle = false; }
    n.headingDepth = headerMatch[1].length;
    if (bodyBlocks.length) n.bodyBlocks = bodyBlocks;
    if (pendingIsChildPage) { n.isChildPage = true; pendingIsChildPage = false; }
    nodes.push(n); nodeMap[id] = n;
    edges.push({ from: parentId, to: id });
    newIds.add(id);
    currentParents[mdDepth] = id;
    for (let d = mdDepth + 1; d <= 5; d++) currentParents[d] = null;
    if (nextIdx > i + 1) i = nextIdx - 1;
  }
  return newIds;
}

async function _loadEntryNode(node, pageId) {
  if (!_addedPageIds.has(pageId)) return;
  const cacheKey = `snlog_entry_${node.entryNotionId}`;
  let md = sessionStorage.getItem(cacheKey);
  if (!md) {
    try {
      const data = await notionFetch({ pageId: node.entryNotionId, action: 'entry' });
      md = data.markdown || '';
      if (md) try { sessionStorage.setItem(cacheKey, md); } catch(e) {}
    } catch(e) { return; }
  }
  if (!md) return;
  const newIds = _addEntryChildNodes(node, md);
  if (newIds.size > 0) {
    newIds.forEach(id => { if (nodeMap[id]) nodeMap[id].visible = true; });
    nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
    isStable = false;
    const nestedChildPages = [...newIds].map(id => nodeMap[id]).filter(n => n?.entryNotionId);
    for (const child of nestedChildPages) await _loadEntryNode(child, pageId);
  } else {
    // 헤딩 없는 엔트리: 본문 블록 마커를 파싱해 desc + bodyBlocks 구성
    const bb = [], descArr = [];
    let cur = null;
    const flush = () => { if (cur) { bb.push({ id: cur.id, text: cur.lines.join('\n') }); cur = null; } };
    for (const raw of md.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const m = t.match(/^\[BB:([a-f0-9]+)\]$/);
      if (m) { flush(); cur = { id: m[1], lines: [] }; continue; }
      if (/^\[(?:BLOCK|NOTION_ENTRY|DB_NODE|CHILD_PAGE|TGL)[^\]]*\]$/.test(t)) { flush(); continue; }
      descArr.push(raw.replace(/^#{1,5}\s+/, ''));
      if (cur) cur.lines.push(bodyBlockText(raw));
    }
    flush();
    node.desc = cleanDesc(descArr.join('\n').substring(0, 5000).trim());
    if (bb.length) node.bodyBlocks = bb;
  }
}

async function _loadEntriesBackground(pageId) {
  const entryNodes = nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId);
  if (!entryNodes.length) return;
  const total = entryNodes.length;
  let loaded = 0;

  const getTag = () => document.querySelector(`[data-page-id="${pageId}"] .entry-load-tag`);
  const setTag = (t) => { const el = getTag(); if (el) el.textContent = t; };

  const item = document.querySelector(`[data-page-id="${pageId}"]`);
  const labelEl = item?.querySelector('.item-label') || item?.querySelector('span');
  if (labelEl && !labelEl.querySelector('.entry-load-tag')) {
    labelEl.insertAdjacentHTML('beforeend', ` <span class="entry-load-tag" style="color:rgba(237,112,0,0.45);font-size:9px;">로딩 0/${total}</span>`);
  }

  for (const node of entryNodes) {
    await _loadEntryNode(node, pageId);
    loaded++; setTag(`로딩 ${loaded}/${total}`);
  }

  const tag = getTag(); if (tag) tag.remove();
  try {
    const c = sessionStorage.getItem(`snlog_${pageId}`);
    if (c) { const p = JSON.parse(c); delete p._headingsOnly; sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify(p)); }
  } catch(e) {}
  loadManualLinks();
  if (typeof resolveWikiLinks === 'function') resolveWikiLinks(); // 엔트리 본문까지 로드된 뒤 [](url) 링크 재해석
}

// ── 파일 임포트 / 내보내기 ───────────────────────────────────────────

function _importMdFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const markdown = e.target.result;
      const title = file.name.replace(/\.md$|\.txt$/i, '');
      const pageId = 'md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      mergeGraph(title, markdown, pageId);
      _addedPageIds.add(pageId);
      sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown, isMd: true, _cachedAt: Date.now() }));
      const wrap = document.getElementById('sidebar-page-list-wrap');
      if (wrap) wrap.style.display = 'block';
      if (!window._sidebarPageList) window._sidebarPageList = [];
      window._sidebarPageList.push({ id: pageId, title, isMd: true });
      refreshSidebarRender();
      resolve();
    };
    reader.readAsText(file);
  });
}

function importMarkdownFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  _importMdFile(file).then(() => { updateBulkActionsVisibility(); savePageList(); });
  event.target.value = '';
}

async function importMarkdownFolder(event) {
  const files = [...event.target.files].filter(f => /\.(md|txt)$/i.test(f.name));
  for (const file of files) { await _importMdFile(file); }
  updateBulkActionsVisibility(); savePageList();
  event.target.value = '';
}

// 레일 이미지 저장 버튼 → 사이즈 선택 플로팅 메뉴 (설정에서 미리 고르지 않고 저장 시점에 선택)
function _closeExportSizeMenu() {
  const m = document.getElementById('export-size-menu');
  if (m) m.remove();
  document.removeEventListener('mousedown', _exportSizeOutside, true);
}
function _exportSizeOutside(e) {
  const m = document.getElementById('export-size-menu');
  if (m && !m.contains(e.target)) _closeExportSizeMenu();
}
function openExportSizeMenu(btn) {
  if (document.getElementById('export-size-menu')) { _closeExportSizeMenu(); return; }
  const menu = document.createElement('div');
  menu.id = 'export-size-menu';
  menu.className = 'export-size-menu';
  const sizes = [1024, 2048, 4096];
  menu.innerHTML = `<div class="esm-title">이미지 크기</div>`
    + sizes.map(s => `<button class="esm-btn${s === _exportSize ? ' on' : ''}" data-size="${s}">${s}px</button>`).join('');
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = (r.right + 8) + 'px';
  menu.style.top = Math.max(8, Math.min(r.top, window.innerHeight - menu.offsetHeight - 12)) + 'px';
  menu.querySelectorAll('.esm-btn').forEach(b => {
    b.onclick = () => {
      const size = parseInt(b.dataset.size);
      _exportSize = size;
      try { localStorage.setItem('snlog_export_size', String(size)); } catch (e) {}
      _closeExportSizeMenu();
      exportGraph(size);
    };
  });
  setTimeout(() => document.addEventListener('mousedown', _exportSizeOutside, true), 0);
}

function exportGraph(size) {
  const SIZE = size || _exportSize || 2048, PADDING = 60;
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
  const minX = Math.min(...rxv), maxX = Math.max(...rxv);
  const minY = Math.min(...ryv), maxY = Math.max(...ryv);
  const graphW = maxX - minX || 1, graphH = maxY - minY || 1;
  const exportScale = (SIZE - PADDING * 2) / Math.max(graphW, graphH);
  const offscreen = document.createElement('canvas');
  offscreen.width = SIZE; offscreen.height = SIZE;
  const ctx2 = offscreen.getContext('2d');
  ctx2.fillStyle = '#0a0c14'; ctx2.fillRect(0, 0, SIZE, SIZE);
  const offsetX = (SIZE - graphW * exportScale) / 2 - minX * exportScale;
  const offsetY = (SIZE - graphH * exportScale) / 2 - minY * exportScale;
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  ctx2.save(); ctx2.translate(offsetX, offsetY); ctx2.scale(exportScale, exportScale);
  edges.forEach(e => {
    const a = nodeMap[e.from], b = nodeMap[e.to];
    if (!a?.visible || !b?.visible || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return;
    const edgeRgb = _colorScheme === 'depth' ? nodeRgb(b) : hexToRgb(a.color || '#ffffff');
    if (hasSearch) {
      const bothMatch = searchMatches.has(e.from) && searchMatches.has(e.to);
      const eitherMatch = searchMatches.has(e.from) || searchMatches.has(e.to);
      if (!eitherMatch) return;
      ctx2.setLineDash(bothMatch ? [] : [4,5]);
      ctx2.strokeStyle = rgbStr(edgeRgb, bothMatch ? 0.9 : 0.3);
      ctx2.lineWidth = (bothMatch ? 1.0 : 0.5) * CONFIG.linkWidth;
    } else if (e.manualLink) { ctx2.setLineDash([4,5]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.6); ctx2.lineWidth = 0.8 * CONFIG.linkWidth; }
    else if (e.weakLink) { ctx2.setLineDash([4,4]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.2); ctx2.lineWidth = 0.6 * CONFIG.linkWidth; }
    else { ctx2.setLineDash([]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.55); ctx2.lineWidth = 0.7 * CONFIG.linkWidth; }
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
      const childCount = getChildCount(n.id);
      if (childCount >= 3) {
        const hubStrength = Math.min((childCount - 2) / 4, 1);
        const glowR = r + 8 + hubStrength * 22;
        ctx2.beginPath(); ctx2.arc(nx, ny, glowR, 0, Math.PI*2);
        const gH = ctx2.createRadialGradient(nx, ny, r, nx, ny, glowR);
        gH.addColorStop(0, rgbStr(rgb, 0.28 + hubStrength * 0.15)); gH.addColorStop(1, rgbStr(rgb, 0));
        ctx2.fillStyle = gH; ctx2.fill();
      }
    }
    if(n.level===0) drawStar8(ctx2, nx, ny, r);
    else if(n.isDbNode) drawStar4(ctx2, nx, ny, r);
    else if(n.isChildPage || n.entryNotionId) drawStarX(ctx2, nx, ny, r);
    else { ctx2.beginPath(); ctx2.arc(nx, ny, r, 0, Math.PI*2); }
    ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : rgbStr(rgb, 1); ctx2.fill();
    if (_showLabels) {
      let lbl = n.label ? n.label.replace(/[\n]/g, ' ') : '';
      if (n.level >= 2 && lbl.length > 14) lbl = lbl.substring(0,13) + '…';
      const fontSize = (n.level <= 1 ? 12 : 10) * (typeof _labelScale === 'number' ? _labelScale : 1);
      ctx2.font = n.level <= 1 ? `bold ${fontSize}px 'Noto Sans KR', sans-serif` : `500 ${fontSize}px 'Noto Sans KR', sans-serif`;
      ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : 'rgba(215,220,230,0.85)';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
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
