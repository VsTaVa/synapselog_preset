// ── Notion 클라이언트 & 페이지 관리 ────────────────────────────────

let _savedToken = _decKey(sessionStorage.getItem('snlog_token')) || _decKey(localStorage.getItem('snlog_token')) || '';
let _addedPageIds = new Set();

// ── 로컬 폴더 동기화 (File System Access API, Chrome/Edge) ────────────

function _idbOpen() {
  if (!_useLocalStorage) return Promise.reject(new Error('로컬 저장 사용 꺼짐'));
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
  const text = normalizeNotionMd(await file.text()); // 노션 내보내기 속성·이스케이프 정리
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
  const text = normalizeNotionMd(await file.text()); // 노션 내보내기 속성·이스케이프 정리
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
  const rootRow = _registerFolderRows(folderBatchId, window._folderBatches.get(folderBatchId));
  if (rootRow) _expandedPages.add(rootRow); // 방금 불러온 폴더는 펼쳐둠
  refreshFolderRows(); updateBulkActionsVisibility(); savePageList();
}

async function loadFolderBatches() {
  if (!window.showDirectoryPicker) return;
  try {
    const recs = await _idbGetAllFolders();
    if (!window._folderBatches) window._folderBatches = new Map();
    recs.forEach(r => window._folderBatches.set(r.id, { handle: r.handle, name: r.name, files: new Map(r.files) }));
    refreshFolderRows();
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
  refreshFolderRows(); updateBulkActionsVisibility(); savePageList();
}

async function syncFolderBatches() {
  if (!window._folderBatches || window._folderBatches.size === 0) return;
  for (const [folderBatchId, batch] of window._folderBatches) {
    try { await _syncOneFolderBatch(folderBatchId, batch); } catch(e) {}
  }
  refreshFolderRows(); updateBulkActionsVisibility(); savePageList();
}

// ── MD 폴더 → 페이지 목록 트리 ────────────────────────────────────────
// 폴더 구조를 노션 하위 페이지와 같은 방식으로 보여준다: 디렉터리마다 묶음 행을 만들고
// 파일 행에 parentId로 매달아, _orderPagesByHierarchy가 들여쓰기·접기를 그대로 처리하게 함
function _folderRowId(folderBatchId, relDir) { return relDir ? `fld:${folderBatchId}:${relDir}` : `fld:${folderBatchId}`; }

function _registerFolderRows(folderBatchId, batch) {
  if (!batch) return null;
  if (!window._sidebarPageList) window._sidebarPageList = [];
  const list = window._sidebarPageList;
  const byId = new Map(list.map(r => [r.id, r]));
  const ensureDir = (relDir) => {
    const id = _folderRowId(folderBatchId, relDir);
    if (byId.has(id)) return id;
    const parts = relDir ? relDir.split('/') : [];
    const parentId = relDir ? ensureDir(parts.slice(0, -1).join('/')) : null;
    const row = { id, title: relDir ? parts[parts.length - 1] : (batch.name || '폴더'),
                  isFolder: true, folderBatchId, folderRel: relDir, parentId };
    list.push(row); byId.set(id, row);
    return id;
  };
  const rootId = ensureDir('');
  for (const [path, info] of batch.files) {
    const parts = String(path).split('/');
    const title = parts.pop().replace(/\.md$|\.txt$/i, '');
    const dirId = ensureDir(parts.join('/'));
    const existing = byId.get(info.pageId);
    if (existing) { Object.assign(existing, { title, isMd: true, hasHandle: true, folderBatchId, parentId: dirId }); }
    else { const row = { id: info.pageId, title, isMd: true, hasHandle: true, folderBatchId, parentId: dirId }; list.push(row); byId.set(row.id, row); }
  }
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'block';
  return rootId;
}

// 파일이 다 빠진 폴더 행은 남기지 않음 (안쪽부터 바깥으로 반복 정리)
function _pruneEmptyFolderRows() {
  if (!window._sidebarPageList) return;
  for (let guard = 0; guard < 20; guard++) {
    const used = new Set(window._sidebarPageList.map(r => r.parentId).filter(Boolean));
    const next = window._sidebarPageList.filter(r => !(r.isFolder && !used.has(r.id)));
    if (next.length === window._sidebarPageList.length) return;
    window._sidebarPageList = next;
  }
}

function _unregisterFolderRows(folderBatchId) {
  if (!window._sidebarPageList) return;
  window._sidebarPageList = window._sidebarPageList.filter(r => r.folderBatchId !== folderBatchId);
}

// 배치 전체를 페이지 목록에 다시 반영 (임포트/동기화/복원 공통)
function refreshFolderRows() {
  if (window._folderBatches) {
    for (const [id, batch] of window._folderBatches) _registerFolderRows(id, batch);
  }
  _pruneEmptyFolderRows();
  refreshSidebarRender();
}

async function removeFolderBatch(folderBatchId) {
  const batch = window._folderBatches?.get(folderBatchId);
  if (!batch) return;
  for (const [, info] of [...batch.files]) { removePage(info.pageId, document.querySelector(`[data-page-id="${info.pageId}"]`)); }
  window._folderBatches.delete(folderBatchId);
  _unregisterFolderRows(folderBatchId);
  try { await _idbDelete('folders', folderBatchId); } catch(e) {}
  refreshFolderRows(); updateBulkActionsVisibility(); savePageList();
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
  if (!res.ok) throw new Error(data.error || '오류 발생');
  return data;
}

// ── 노션 쓰기: 블록 텍스트 수정 ──────────────────────────────────────

// checked를 넘기면 to_do 블록의 체크 상태까지 함께 반영(안 넘기면 노션의 기존 상태 유지)
async function notionUpdateBlock(blockId, text, checked) {
  return notionFetch({ action: 'updateBlock', blockId, text, ...(typeof checked === 'boolean' ? { checked } : {}) });
}

async function notionAppendBlock(parentId, afterId, text, blockType) {
  return notionFetch({ action: 'appendBlock', parentId, afterId, text, blockType });
}

// 여러 블록을 한 번의 호출로 추가 → ['id', ...] 배열 반환 (순서 보존)
// exact=true면 afterId 블록 '바로 뒤'에 정밀 삽입(섹션 끝으로 안 밀림) — 최소 이동용
// types/checks는 texts와 같은 길이의 배열 — 옮겨지는 블록의 원래 유형·체크 상태를 그대로 재생성할 때 씀
async function notionAppendBlocks(parentId, afterId, texts, blockType, exact, types, checks) {
  const res = await notionFetch({ action: 'appendBlocks', parentId, afterId, texts, blockType, exact: !!exact, types, checks });
  return (res && res.ids) || [];
}

async function notionDeleteBlock(blockId) {
  return notionFetch({ action: 'deleteBlock', blockId });
}

// 헤딩 + 그 섹션 전체 삭제 — 앱이 못 읽는 블록(코드·이미지·표 등)까지 서버가 children 기준으로 지운다
// → 지워진 블록 ID 배열(문서 순서)
async function notionDeleteSection(blockId, parentId) {
  const res = await notionFetch({ action: 'deleteSection', blockId, parentId });
  return (res && res.ids) || [];
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
    // 임시(local_) 노드만 여기에 저장. MD 파일(md_)은 원본 파일/세션으로 따로 관리하므로 제외(이중 복원 방지)
    const roots = nodes.filter(n => n.local && n.level === 0 && String(n.sourcePageId || '').startsWith('local_'));
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

// 마크다운 텍스트 → 임시(local_) 페이지. /Import·붙여넣기가 같은 경로를 쓰게 하는 공통 진입점
function addMarkdownPage(title, markdown) {
  const pageId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  mergeGraph(title, markdown || '', pageId);
  nodes.forEach(n => { if (n.sourcePageId === pageId) { n.local = true; n.visible = true; } });
  const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
  if (root) root.headingDepth = 0;
  _addedPageIds.add(pageId);
  saveLocalPages();
  _registerLocalInList(pageId, title);
  refreshSidebarRender();
  updateBulkActionsVisibility();
  isStable = false;
  return root;
}

function newLocalRoot() {
  const inp = document.getElementById('new-root-input');
  const t = inp ? inp.value.trim() : '';
  if (!t) { if (inp) inp.focus(); return; }
  createLocalRoot(t);
  if (inp) inp.value = '';
}

// 노드 하위 트리를 .md 파일로 내보내기
function exportNodeMarkdown(node) {
  // 페이지 제목(레벨0)은 파일명이 곧 제목 — 헤딩으로 내보내지 않는다(원본 되쓰기와 같은 규칙).
  // 헤딩 노드를 내보낼 땐 그 노드가 문서의 제목이 되므로 #로 쓴다.
  let md;
  if (node.level === 0) md = buildFileMarkdown(node);
  else {
    md = '# ' + node.label + '\n';
    if (node.desc && node.desc !== '(내용 없음)') md += node.desc.replace(/\n+$/, '') + '\n';
    md += serializeChildrenMd(node.id, 2);
  }
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
  else alert('내보낼 내용 없음. 페이지를 먼저 불러오거나 열기.');
}

// ── 로컬(MD) 원본 파일 쓰기 (File System Access, readwrite) ──────────────
// 임포트가 파일명을 가상 루트(레벨0)로 넣으므로, 파일 재구성 땐 루트 헤딩을 쓰지 않고
// 각 노드의 headingDepth로 원래 #레벨을 복원한다(단순 재구성 시 #→## 밀림 방지).
function _serializeFileChildren(nodeId) {
  let md = '';
  edges.filter(e => e.from === nodeId && !e.weakLink && !e.manualLink).forEach(e => {
    const c = nodeMap[e.to];
    if (!c) return;
    const depth = Math.min(Math.max(c.headingDepth || 1, 1), 6);
    md += '#'.repeat(depth) + ' ' + c.label + '\n';
    if (c.desc && c.desc !== '(내용 없음)') md += c.desc.replace(/\n+$/, '') + '\n';
    md += _serializeFileChildren(c.id);
  });
  return md;
}
function buildFileMarkdown(root) {
  let md = '';
  if (root.titleHeading) md += '# ' + root.label + '\n'; // 원본이 제목 H1로 시작했으면 그대로 되살림
  if (root.desc && root.desc !== '(내용 없음)') md += root.desc.replace(/\n+$/, '') + '\n';
  md += _serializeFileChildren(root.id);
  return md.replace(/^\n+/, '');
}
function _mdPageMeta(pageId) {
  try { return JSON.parse(sessionStorage.getItem('snlog_' + pageId) || 'null'); } catch (e) { return null; }
}
// relPath(디렉터리 기준 상대경로)로 폴더 배치 안의 파일 핸들 획득
async function _fileHandleFromDir(dir, relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  if (!parts.length) return null;
  let cur = dir;
  for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i]);
  return cur.getFileHandle(parts[parts.length - 1]);
}
// 단일 파일 임포트(_mdFileHandles) 또는 폴더 배치(디렉터리 핸들+relPath)에서 쓰기 핸들 해석
async function _mdWriteHandle(pageId) {
  const info = window._mdFileHandles && window._mdFileHandles.get(pageId);
  if (info && info.handle) return { handle: info.handle, single: info };
  const meta = _mdPageMeta(pageId);
  if (meta && meta.folderBatchId && meta.relPath && window._folderBatches) {
    const batch = window._folderBatches.get(meta.folderBatchId);
    if (batch && batch.handle) {
      try { const fh = await _fileHandleFromDir(batch.handle, meta.relPath); if (fh) return { handle: fh, batch, relPath: meta.relPath, folderBatchId: meta.folderBatchId }; } catch (e) {}
    }
  }
  return null;
}
// 현재 그래프의 해당 파일 내용을 원본 .md에 덮어쓴다. 핸들 없으면(입력창 폴백) false.
async function writeBackMdFile(pageId) {
  if (!pageId) return false;
  const root = nodes.find(n => n.sourcePageId === pageId && n.level === 0);
  if (!root) return false;
  const resolved = await _mdWriteHandle(pageId);
  if (!resolved || !resolved.handle) return false; // 핸들 없이 임포트된 파일은 원본 쓰기 불가
  const handle = resolved.handle;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') { toast('파일 쓰기 권한 필요', { type: 'error' }); return false; }
  // 제목(=파일명) 변경 시 실제 파일 이름도 변경 (Chromium handle.move 지원 시). 실패해도 내용은 저장
  const base = (root.label || 'note').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 60).trim() || 'note';
  const desiredName = base + '.md';
  if (handle.name && handle.name !== desiredName && typeof handle.move === 'function') {
    try {
      let name = desiredName, i = 1;
      if (resolved.batch) {
        const sib = new Set([...resolved.batch.files.keys()].map(p => p.split('/').pop().toLowerCase()));
        sib.delete(String(resolved.relPath || '').split('/').pop().toLowerCase());
        while (sib.has(name.toLowerCase())) name = `${base}-${i++}.md`;
      }
      await handle.move(name);
      if (resolved.batch && resolved.relPath != null) {
        const oldRel = resolved.relPath;
        const newRel = (oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/') + 1) : '') + name;
        const rec = resolved.batch.files.get(oldRel);
        resolved.batch.files.delete(oldRel);
        if (rec) resolved.batch.files.set(newRel, rec);
        resolved.relPath = newRel;
      }
    } catch (e) {}
  }
  const md = buildFileMarkdown(root);
  const w = await handle.createWritable();
  await w.write(md); await w.close();
  // 세션 캐시 갱신(제목·relPath 포함 — 재로드 시 제목이 옛 파일명으로 되돌아가는 것 방지)
  try { const meta = _mdPageMeta(pageId) || {}; meta.markdown = md; meta.title = root.label; if (resolved.relPath != null) meta.relPath = resolved.relPath; meta._cachedAt = Date.now(); sessionStorage.setItem('snlog_' + pageId, JSON.stringify(meta)); } catch (e) {}
  // 방금 쓴 걸 외부 변경으로 오인해 재동기화하지 않도록 lastModified 갱신
  try {
    const lm = (await handle.getFile()).lastModified;
    if (resolved.single) { resolved.single.lastModified = lm; await _idbSave('files', { id: pageId, handle, lastModified: lm }); }
    else if (resolved.batch && resolved.relPath) {
      const rec = resolved.batch.files.get(resolved.relPath);
      if (rec) { rec.lastModified = lm; resolved.batch.files.set(resolved.relPath, rec); }
      if (typeof _saveFolderBatchToIDB === 'function') await _saveFolderBatchToIDB(resolved.folderBatchId);
    }
  } catch (e) {}
  return true;
}

// ── 로그인/페이지 선택 ───────────────────────────────────────────────

// 설정 없이 바로 둘러보는 샘플 그래프 — .MD 임포트와 동일 경로라 별도 처리 불필요
const _SAMPLE_MD = `# 노트 샘플

이 노드는 샘플입니다. 노션 없이 기능을 그대로 사용해볼 수 있습니다.

## 화면 조작

**마우스 휠** -> 확대&축소
**좌클릭 드래그** -> 이동
**우클릭 드래그** -> 화면 회전
**빈 공간 더블 클릭** -> 화면 맞춤

## 노드 사용

**노드 좌클릭** -> 노드 상세 보기
**노드 우클릭(모바일: 더블탭)** -> 노드 선택 툴(연결&북마크&삭제 등)
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
- **그래프 설정:** (노드 반발력 슬라이더, 중력, 노드 크기, 링크 선 두께, 노드 허브, 제목 글자 크기)

### 검색

- 키워드 검색 기능

### AI

- **/Node Summary:** 단일 또는 복수 노드 요약
- **/Node Link:** 노드 연결 추천 기능
- **/Node Edit:** 선택한 노드 본문 다듬기
- **/import:** 웹&유튜브(자막) 링크를 마크다운 노드로 가져오기
- **AI 키워드 검색 요약 기능**

### 범례

기호, 도구, AI에 대한 상세 설명

### 화면맞춤

### 이미지 저장

- 이미지 크기 조절
-> 1024x1024px / 2048x2048px / 4096x4096px

### 설정

#### 언어 / LANGUAGE

앱 UI 언어 변경
- 한국어 / English

#### 저장 & 캐시

1. 로컬 저장 변경
2. Notion API & AI API 입력 및 삭제
3. 캐시 삭제

#### 키보드 단축키

(버튼 클릭 후 원하는 키 입력)
- 제목 숨김 / 복원: \`T\`
- 패널 숨기기: \`esc\`
- 노드 고정 / 해제: \`Ctrl+클릭\`
- 노드 선택: \`우클릭\`
- 화면 맞춤: \`space\` or \`더블 클릭\`
- 화면 확대 / 축소: \`마우스 휠\`
- 화면 회전: \`우클릭 + 그래그\`

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

### 위성 모드

- 기존 그래프 형식에서 떼어내 하위 노드와 함께 외곽으로 밀어냅니다.

### 노드 고정

- 선택한 노드의 위치를 캔버스 상에 고정`;

function startWithSample() {
  document.getElementById('login-screen').style.display = 'none';
  const title = '샘플 노트', pageId = 'md_sample_' + Date.now();
  const register = () => {
    _addedPageIds.add(pageId);
    sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ title, markdown: _SAMPLE_MD, isMd: true, _cachedAt: Date.now() }));
    const wrap = document.getElementById('sidebar-page-list-wrap');
    if (wrap) wrap.style.display = 'block';
    if (!window._sidebarPageList) window._sidebarPageList = [];
    window._sidebarPageList.push({ id: pageId, title, isMd: true });
    refreshSidebarRender();
    updateBulkActionsVisibility(); savePageList();
  };
  buildGraph(); loop();
  setTimeout(() => {
    mergeGraph(title, _SAMPLE_MD, pageId);
    register();
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
  if (!token) { errEl.textContent = 'Notion API Token 입력'; errEl.style.display = 'block'; return; }
  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
    errEl.textContent = '올바른 토큰 형식 아님 (secret_ 또는 ntn_ 으로 시작)';
    errEl.style.display = 'block'; return;
  }
  _savedToken = token;
  try { sessionStorage.setItem('snlog_token', _encKey(token)); } catch(e) {}
  if (_useLocalStorage) { try { localStorage.setItem('snlog_token', _encKey(token)); } catch(e) {} }
  errEl.style.display = 'none';
  showPagePicker();
}

async function showPagePicker() {
  const loginBox = document.getElementById('login-box');
  // 토큰 입력 폼을 덮어쓰기 전에 원본을 보관 — 시작 화면으로 돌아갈 때 복원용
  if (loginBox && !window._loginBoxHtml) window._loginBoxHtml = loginBox.innerHTML;
  loginBox.innerHTML = `
    <button type="button" class="picker-back" onclick="backToTokenInput()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>뒤로 가기</button>
    <div class="login-title">Synapse<span>Log</span></div>
    <div class="login-sub picker-sub">불러올 페이지 선택</div>
    <div class="picker-search-wrap">
      <input type="text" id="page-search-input" autocomplete="off" placeholder="페이지 검색..." oninput="filterPageList(this.value)" />
    </div>
    <div id="page-list">
      <div class="picker-hint">불러오는 중...</div>
    </div>
    <div class="picker-actions">
      <button class="picker-btn primary" onclick="startWithSelected()">선택한 페이지 불러오기</button>
      <button class="picker-btn" onclick="skipToGraph()">건너뛰기</button>
    </div>
    <div id="page-pick-error"></div>
  `;
  try {
    const data = await notionFetch({ action: 'list' });
    window._pageList = data.pages || [];
    renderPageList(window._pageList);
  } catch(e) {
    document.getElementById('page-list').innerHTML = `<div class="picker-hint err">${escapeHtml(e.message)}</div>`;
  }
}

// 페이지 선택 화면 → 토큰 입력 화면으로 복귀 (토큰을 잘못 넣었을 때 빠져나올 길)
function backToTokenInput() {
  const box = document.getElementById('login-box');
  if (!box || !window._loginBoxHtml) return;
  box.innerHTML = window._loginBoxHtml;
  window._selectedPageIds = new Set();
  const input = document.getElementById('input-token');
  if (input) { input.value = _savedToken || ''; input.focus(); input.select(); }
  const err = document.getElementById('login-error');
  if (err) err.style.display = 'none';
}

window._selectedPageIds = new Set();

function renderPageList(pages) {
  const list = document.getElementById('page-list');
  if (!list) return;
  window._lastPickerPages = pages; // 토글로 다시 그릴 때 검색 필터 결과 유지
  if (pages.length === 0) { list.innerHTML = _emptyPagesHtml(false); return; }
  // 사이드바 목록과 동일하게 상위/하위를 트리 순서 + 들여쓰기 가이드로 표시
  const ordered = _orderPagesByHierarchy(pages.filter(p => p.title && p.title.trim()));
  const vis = _visibleRows(ordered);
  list.innerHTML = vis.map((row, i) => row.p.isDatabase ? `
    <div class="${_pliRowClass(vis, i)}" style="--d:${row.depth}">
      ${_pliGuides(vis, i)}${_pliToggle(row)}
      <div class="page-pick-item pli-group">
        <span class="pick-label">${escapeHtml(row.p.title) || '(제목 없음)'}</span>
      </div>
    </div>
  ` : `
    <div class="${_pliRowClass(vis, i)}" style="--d:${row.depth}">
      ${_pliGuides(vis, i)}${_pliToggle(row)}
      <div class="page-pick-item${window._selectedPageIds.has(row.p.id) ? ' selected' : ''}" data-id="${row.p.id}" onclick="togglePageSelect('${row.p.id}', this)">
        <div class="pick-check"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="2,5 4,7 8,3" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <span class="pick-label">${escapeHtml(row.p.title) || '(제목 없음)'}</span>
      </div>
    </div>
  `).join('');
}

function togglePageSelect(pageId, el) {
  const on = !window._selectedPageIds.has(pageId);
  if (on) window._selectedPageIds.add(pageId); else window._selectedPageIds.delete(pageId);
  el.classList.toggle('selected', on); // 표시는 CSS가 담당 — 재렌더돼도 선택 상태가 유지됨
}

function filterPageList(query) {
  if (!window._pageList) return;
  const filtered = query.trim() ? window._pageList.filter(p => p.title.toLowerCase().includes(query.toLowerCase())) : window._pageList;
  renderPageList(filtered);
}

async function startWithSelected() {
  if (window._selectedPageIds.size === 0) {
    const errEl = document.getElementById('page-pick-error');
    if (errEl) { errEl.textContent = '페이지를 하나 이상 선택'; errEl.style.display = 'block'; }
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

// 노션에서 접근 가능한 페이지 목록을 다시 받아 사이드바에 반영.
// 새로 만든 페이지·새 토큰으로 바뀐 목록이 여기서 들어온다. → 새로 발견한 페이지 수 반환
async function refreshSidebarPageList() {
  if (!_savedToken) return 0;
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return 0;
  // 목록 영역이 접혀 있으면(토큰만 넣고 아직 페이지를 안 담은 상태) 펼쳐준다 —
  // 안 그러면 새로 받아온 목록이 숨겨진 채로 그려져 "반영이 안 된다"로 보인다
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'block';
  listEl.innerHTML = '<div style="font-size:11px; color:rgba(255,255,255,0.25); padding:6px 0; text-align:center;">불러오는 중...</div>';
  try {
    const prevIds = new Set((window._sidebarPageList || []).map(p => p.id));
    const data = await notionFetch({ action: 'list' });
    const pages = data.pages || [];
    // 로컬/MD/폴더 항목은 노션 목록에 없으므로 보존
    const extras = (window._sidebarPageList || []).filter(p => (p.isLocal || p.isMd || p.isFolder) && !pages.some(q => q.id === p.id));
    window._sidebarPageList = pages.concat(extras);
    renderSidebarPageList(window._sidebarPageList);
    return pages.filter(p => !prevIds.has(p.id)).length;
  } catch(e) {
    listEl.innerHTML = `<div style="font-size:11px; color:#ff6b6b; padding:6px 0; text-align:center;">${e.message}</div>`;
    return 0;
  }
}

function renderSidebarPageList(pages) {
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return;
  _wireSidebarDnd(listEl);
  if (!pages || !pages.length) { listEl.innerHTML = _emptyPagesHtml(true); return; }
  const ordered = _orderPagesByHierarchy([...pages].filter(p => p.title && p.title.trim()), { byAdded: true });
  const vis = _visibleRows(ordered);
  listEl.innerHTML = vis.map((row, i) => `<div class="${_pliRowClass(vis, i)}" style="--d:${row.depth}">${_pliGuides(vis, i)}${_pliToggle(row)}${_pageItemHtml(row.p)}</div>`).join('');
}

// 목록이 비는 가장 흔한 원인은 '통합을 페이지에 연결' 누락 — 원인과 해결을 같이 안내
function _emptyPagesHtml(compact) {
  return `<div class="pages-empty${compact ? ' compact' : ''}">
    <div class="pe-title">연결된 페이지 없음</div>
    <div class="pe-desc">노션에서 통합을 연결한 페이지만 목록에 표시.</div>
    <ol class="pe-steps">
      <li>노션에서 원하는 페이지 열기</li>
      <li>우측 상단 <b>···</b> → <b>연결</b></li>
      <li>발급 때 만든 <b>integration</b> 선택</li>
    </ol>
    <a class="pe-link" href="https://www.notion.so/my-integrations" target="_blank" rel="noopener">통합 관리 열기</a>
  </div>`;
}

// 하위 페이지 접기/펼치기 — 기본은 전부 닫힘(세션 중에만 유지)
let _expandedPages = new Set();
function togglePageGroup(id) {
  if (_expandedPages.has(id)) _expandedPages.delete(id); else _expandedPages.add(id);
  if (window._lastPickerPages && document.getElementById('page-list')) renderPageList(window._lastPickerPages);
  refreshSidebarRender();
}
// 닫힌 상위가 조상 중 하나라도 있으면 숨김
function _visibleRows(ordered) {
  const rowById = new Map(ordered.map(r => [r.p.id, r]));
  return ordered.filter(r => {
    let pid = r.parentRowId;
    while (pid) {
      if (!_expandedPages.has(pid)) return false;
      const pr = rowById.get(pid);
      pid = pr ? pr.parentRowId : null;
    }
    return true;
  });
}
// 하위가 있는 행엔 토글, 없으면 같은 폭의 빈 칸(줄맞춤용)
function _pliToggle(row) {
  if (!row.hasKids) return '<span class="pli-toggle-sp"></span>';
  const open = _expandedPages.has(row.p.id);
  return `<button class="pli-toggle${open ? ' open' : ''}" title="하위 페이지 펼치기/접기" aria-label="하위 페이지 펼치기/접기" onclick="event.stopPropagation();togglePageGroup('${row.p.id}')"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></button>`;
}

// 들여쓰기 가이드 클래스 — 같은 깊이가 연속된 구간의 처음/끝을 '[' 처럼 꺾기 위한 표시
function _pliIndex(ordered) {
  if (!ordered._idx) ordered._idx = new Map(ordered.map((r, n) => [r.p.id, n]));
  return ordered._idx;
}
// 자손 행은 건너뛰고, 같은 부모를 둔 같은 깊이의 형제가 그 방향에 있는지 판정
function _pliHasSibling(ordered, row, dir) {
  const start = _pliIndex(ordered).get(row.p.id);
  if (start === undefined) return false;
  for (let j = start + dir; j >= 0 && j < ordered.length; j += dir) {
    const o = ordered[j];
    if (o.depth > row.depth) continue;      // 자손 — 건너뜀
    if (o.depth < row.depth) return false;  // 그룹이 끝남
    // 묶음 머리글(DB·MD 폴더)은 형제로 세지 않음 — 만나면 거기서 그룹이 끊김
    if (o.p.isDatabase || row.p.isDatabase || o.p.isFolder || row.p.isFolder) return false;
    return o.parentRowId === row.parentRowId;
  }
  return false;
}
// 연결선(트리 라인)은 그리지 않음 — 간격(들여쓰기)·토글만 유지
function _pliRowClass(ordered, i) { return 'pli-row'; }
function _pliGuides(ordered, i) { return ''; }

// 상위/하위 페이지를 트리 순서로 정렬하고 깊이를 매김 (부모가 목록에 없으면 최상위로 취급)
// opts.byAdded=true면 '그래프에 추가된 페이지'를 즐겨찾기 다음 순위로 올린다(사이드바 목록 전용).
// 시작 화면 페이지 선택기는 이걸 끈다 — 거기서 체크할 때마다 행이 튀면 고르기 어렵다.
function _orderPagesByHierarchy(pages, opts) {
  const byId = new Map(pages.map(p => [p.id, p]));
  const children = new Map();
  const roots = [];
  pages.forEach(p => {
    const par = (p.parentId && p.parentId !== p.id && byId.has(p.parentId)) ? p.parentId : null;
    if (par) { if (!children.has(par)) children.set(par, []); children.get(par).push(p); }
    else roots.push(p);
  });
  // 순위: ① 즐겨찾기(별) ② 그래프에 추가된 페이지 ③ 나머지.
  // 각 순위 안에서는 파일 탐색기처럼 폴더 먼저, 그다음 제목순.
  // 형제끼리만 비교한다 — 트리(상위-하위)는 그대로 두고 같은 부모 아래에서만 재정렬.
  const byAdded = !!(opts && opts.byAdded);
  const cmp = (a, b) => {
    const fa = _favoritePageIds.has(a.id) ? 0 : 1, fb = _favoritePageIds.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (byAdded) {
      const aa = _addedPageIds.has(a.id) ? 0 : 1, ab = _addedPageIds.has(b.id) ? 0 : 1;
      if (aa !== ab) return aa - ab;
    }
    const da = a.isFolder ? 0 : 1, db = b.isFolder ? 0 : 1;
    if (da !== db) return da - db;
    return (a.title || '').localeCompare(b.title || '', 'ko', { numeric: true });
  };
  const out = [], seen = new Set();
  const walk = (p, depth, parentRowId) => {
    if (seen.has(p.id)) return; // 순환 방어
    seen.add(p.id);
    const kids = (children.get(p.id) || []).sort(cmp);
    out.push({ p, depth, parentRowId: parentRowId || null, hasKids: kids.length > 0 });
    kids.forEach(k => walk(k, depth + 1, p.id));
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
    if (p.isMd || p.isLocal) mdBadge = ` <span class="pli-md-tag">MD</span>`;
    // 행 아이콘은 선 SVG로 통일. 별은 뚫린 5각형이라 같은 굵기면 얇아 보여, 이웃 아이콘과 눈으로 맞도록 2.4로 올림
    const starBtn = `<button class="btn-favorite${isFav ? ' active' : ''}" title="즐겨찾기" onclick="event.stopPropagation();toggleFavorite('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`;
    const exportBtn = `<button class="btn-export" title="MD파일 내보내기" onclick="event.stopPropagation();exportPageById('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>`;
    const syncSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    const removeSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const safeTitle = escapeHtml(p.title) || '(제목 없음)';
    // MD 폴더도 데이터베이스처럼 하위를 묶는 상위 행. 배치 루트에만 동기화/제거를 둔다
    if (p.isFolder) {
      const folderIc = `<svg class="md-folder-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
      const acts = p.folderRel ? '' : `<div class="item-actions">
          <button class="btn-sync" title="폴더 동기화" onclick="event.stopPropagation();syncFolderBatch('${p.folderBatchId}')">${syncSvg}</button>
          <button class="btn-remove" title="폴더 제거" onclick="event.stopPropagation();removeFolderBatch('${p.folderBatchId}')">${removeSvg}</button>
        </div>`;
      return `<div class="page-list-item pli-group" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}">${safeTitle} ${folderIc}</span>
        ${acts}
      </div>`;
    }
    // 데이터베이스도 페이지처럼 그래프로 열 수 있다 — 항목들이 하위 노드가 된다.
    // 하위를 묶는 상위 행이기도 하므로 pli-group 모양은 유지한다.
    if (p.isDatabase) {
      const dbActs = isActive ? `<div class="item-actions">
          <button class="btn-sync" title="동기화 (바뀐 부분만)" onclick="event.stopPropagation();syncPage('${p.id}')">${syncSvg}</button>
          <button class="btn-remove" onclick="event.stopPropagation();removePage('${p.id}', document.querySelector('[data-page-id=&quot;${p.id}&quot;]'))">${removeSvg}</button>
        </div>` : '';
      return `<div class="page-list-item pli-group${isActive ? ' active' : ''}" data-page-id="${p.id}">
        <span class="item-label" title="${safeTitle}" onclick="${isActive ? `focusPage('${p.id}')` : `addPageById('${p.id}')`}">${safeTitle}</span>
        ${dbActs}
      </div>`;
    }
    if (p.isLocal) {
      return `<div class="page-list-item active" data-page-id="${p.id}" draggable="true" title="MD 폴더로 드래그해 넣기">
        <span class="item-label" title="${safeTitle}" onclick="focusPage('${p.id}')">${safeTitle}${mdBadge}</span>
        <div class="item-actions">
          ${starBtn}
          ${exportBtn}
          <button class="btn-remove" onclick="event.stopPropagation();confirmRemoveLocalPage('${p.id}')">${removeSvg}</button>
        </div>
      </div>`;
    }
    if (isActive) {
      const dragAttr = (p.isMd && p.folderBatchId) ? ' draggable="true" title="폴더 안에서 드래그해 이동"' : '';
      return `<div class="page-list-item active" data-page-id="${p.id}"${dragAttr}>
        <span class="item-label" title="${safeTitle}" onclick="focusPage('${p.id}')">${safeTitle}${mdBadge}</span>
        <div class="item-actions">
          ${starBtn}
          ${exportBtn}
          ${p.isMd ? (p.hasHandle ? `<button class="btn-sync" title="동기화" onclick="event.stopPropagation();syncMdFile('${p.id}')">${syncSvg}</button>` : '') : `<button class="btn-sync" title="동기화 (바뀐 부분만)" onclick="event.stopPropagation();syncPage('${p.id}', {noOverlay:true})">${syncSvg}</button>`}
          <button class="btn-remove" onclick="removePage('${p.id}', document.querySelector('[data-page-id=\\'${p.id}\\']'))">${removeSvg}</button>
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

// 임시(local_) 페이지를 MD 폴더로 드래그 → 드롭. 컨테이너에 한 번만 위임 배선(재렌더에도 유지)
function _wireSidebarDnd(listEl) {
  if (listEl._dndWired) return; listEl._dndWired = true;
  let dragId = null;
  const rowOf = e => e.target.closest('.page-list-item[data-page-id]');
  const meta = id => (window._sidebarPageList || []).find(p => p.id === id);
  const clearMarks = () => listEl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
  // 드래그 가능: 임시(local_) 또는 폴더 안 파일(md_ + folderBatchId)
  const canDrag = p => !!p && (p.isLocal || (p.isMd && p.folderBatchId));
  // 드롭 가능한 폴더: 임시→아무 폴더, 폴더파일→같은 배치 폴더만. 현재 위치와 같으면 제외
  const canDrop = (p, dragged) => {
    if (!p || !p.isFolder || !dragged) return false;
    if (dragged.isLocal) return true;
    if (dragged.isMd && dragged.folderBatchId) {
      if (p.folderBatchId !== dragged.folderBatchId) return false; // 같은 폴더(볼트) 안에서만
      return (p.folderRel || '') !== (dragged.folderRel || ''); // 이미 그 폴더면 제외
    }
    return false;
  };
  listEl.addEventListener('dragstart', e => {
    const row = rowOf(e); if (!row) return;
    const p = meta(row.dataset.pageId);
    if (!canDrag(p)) { e.preventDefault(); return; }
    dragId = row.dataset.pageId;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {} }
    row.classList.add('dragging');
  });
  listEl.addEventListener('dragend', () => { clearMarks(); listEl.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); dragId = null; });
  listEl.addEventListener('dragover', e => {
    if (!dragId) return;
    clearMarks();
    const row = rowOf(e); const p = row && meta(row.dataset.pageId);
    if (canDrop(p, meta(dragId))) { e.preventDefault(); row.classList.add('drop-target'); }
  });
  listEl.addEventListener('drop', e => {
    if (!dragId) return;
    const row = rowOf(e); const p = row && meta(row.dataset.pageId);
    const dragged = meta(dragId);
    clearMarks();
    if (!canDrop(p, dragged)) return;
    e.preventDefault(); const src = dragId; dragId = null;
    if (dragged.isLocal) moveLocalPageToFolder(src, p.folderBatchId, p.folderRel || '');
    else moveFolderFileWithin(src, p.folderRel || ''); // 같은 배치 내 하위폴더/루트로 이동
  });
}
// 폴더 안 파일을 같은 배치의 다른 하위폴더(또는 루트)로 이동 — 실제 파일도 옮김(handle.move)
async function moveFolderFileWithin(pageId, targetRel) {
  const meta = _mdPageMeta(pageId);
  if (!meta || !meta.folderBatchId || meta.relPath == null) { toast('파일 정보를 찾을 수 없음', { type: 'error' }); return; }
  const batch = window._folderBatches && window._folderBatches.get(meta.folderBatchId);
  if (!batch || !batch.handle) { toast('폴더 정보를 찾을 수 없음', { type: 'error' }); return; }
  const oldRel = String(meta.relPath);
  const name = oldRel.split('/').pop();
  const curDir = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : '';
  if (curDir === (targetRel || '')) return; // 같은 폴더면 무시
  let perm = await batch.handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await batch.handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') { toast('폴더 쓰기 권한 필요', { type: 'error' }); return; }
  try {
    const srcHandle = await _fileHandleFromDir(batch.handle, oldRel);
    if (!srcHandle || typeof srcHandle.move !== 'function') { toast('이 브라우저에선 파일 이동 미지원', { type: 'error' }); return; }
    let destDir = batch.handle;
    if (targetRel) { for (const part of targetRel.split('/').filter(Boolean)) destDir = await destDir.getDirectoryHandle(part); }
    // 대상 폴더 내 이름 충돌 회피
    const ext = (name.match(/\.(md|txt)$/i) || ['.md'])[0], base = name.replace(/\.(md|txt)$/i, '');
    const sib = new Set([...batch.files.keys()].filter(p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') === (targetRel || '')).map(p => p.split('/').pop().toLowerCase()));
    let finalName = name, i = 1;
    while (sib.has(finalName.toLowerCase())) finalName = `${base}-${i++}${ext}`;
    await srcHandle.move(destDir, finalName);
    const newRel = targetRel ? `${targetRel}/${finalName}` : finalName;
    const rec = batch.files.get(oldRel); batch.files.delete(oldRel); if (rec) batch.files.set(newRel, rec);
    try { const m2 = _mdPageMeta(pageId) || {}; m2.relPath = newRel; sessionStorage.setItem('snlog_' + pageId, JSON.stringify(m2)); } catch (e) {}
    if (typeof _saveFolderBatchToIDB === 'function') await _saveFolderBatchToIDB(meta.folderBatchId);
    _registerFolderRows(meta.folderBatchId, batch);
    if (typeof _pruneEmptyFolderRows === 'function') _pruneEmptyFolderRows();
    if (typeof savePageList === 'function') savePageList();
    refreshSidebarRender();
    isStable = false;
    toast('파일 이동됨', { type: 'success' });
  } catch (err) { toast('파일 이동 실패: ' + (err.message || err), { type: 'error', duration: 5000 }); }
}

// 임시 페이지의 내용을 MD 폴더 안 새 .md로 저장하고, 임시→폴더 파일로 승격
async function moveLocalPageToFolder(localPageId, folderBatchId, folderRel) {
  const batch = window._folderBatches && window._folderBatches.get(folderBatchId);
  if (!batch || !batch.handle) { toast('폴더 정보를 찾을 수 없음', { type: 'error' }); return; }
  const root = nodes.find(n => n.sourcePageId === localPageId && n.level === 0);
  if (!root) return;
  let perm = await batch.handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await batch.handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') { toast('폴더 쓰기 권한 필요', { type: 'error' }); return; }
  try {
    // 대상 하위 디렉터리 핸들
    let dir = batch.handle;
    if (folderRel) { for (const part of folderRel.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part); }
    // 파일명(충돌 시 -n)
    const base = (root.label || 'note').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 60).trim() || 'note';
    const existingNames = new Set([...batch.files.keys()].map(pth => pth.split('/').pop().toLowerCase()));
    let name = base + '.md', i = 1;
    while (existingNames.has(name.toLowerCase())) name = `${base}-${i++}.md`;
    const relPath = folderRel ? `${folderRel}/${name}` : name;
    // 내용 재구성 → 파일 생성/쓰기
    const md = buildFileMarkdown(root);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(md); await w.close();
    // 임시 페이지 제거 후 폴더 파일로 임포트(중복 방지 위해 제거를 먼저)
    removePage(localPageId, document.querySelector(`[data-page-id="${localPageId}"]`));
    const r = await _importFolderFile(relPath, fh, folderBatchId);
    batch.files.set(relPath, r);
    await _saveFolderBatchToIDB(folderBatchId);
    _registerFolderRows(folderBatchId, batch);
    if (typeof savePageList === 'function') savePageList();
    refreshSidebarRender();
    if (typeof renderMdFolderList === 'function') renderMdFolderList();
    isStable = false;
    toast(`'${root.label}' → ${batch.name || '폴더'} 이동`, { type: 'success' });
  } catch (err) {
    toast('폴더로 이동 실패: ' + (err.message || err), { type: 'error', duration: 5000 });
  }
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
  refreshFolderRows();
  updateBulkActionsVisibility();
}

// 엔트리(DB/하위페이지) 노드의 하위 트리만 제거 — 엔트리 노드 자체는 보존.
// 수동 동기화 시 _loadEntriesBackground가 새로 만들기 전에 호출해 중복 생성 방지.
// 엔트리 노드 1개의 구조적 하위만 제거 (증분: 바뀐 엔트리만 새로 받기 위함)
function _clearEntryDescendantsOf(entryNode) {
  const desc = new Set(); const q = [entryNode.id]; const seen = new Set(q);
  while (q.length) {
    const id = q.shift();
    edges.forEach(e => { if (e.from === id && !e.weakLink && !e.manualLink && !seen.has(e.to)) { seen.add(e.to); desc.add(e.to); q.push(e.to); } });
  }
  if (desc.size) {
    nodes = nodes.filter(n => !desc.has(n.id));
    edges = edges.filter(e => !desc.has(e.from) && !desc.has(e.to));
    desc.forEach(id => delete nodeMap[id]);
  }
  return desc;
}

async function syncPage(pageId, opts) {
  opts = opts || {};
  const item = document.querySelector(`[data-page-id="${pageId}"]`);
  const syncBtn = item?.querySelector('.btn-sync');
  if (syncBtn) syncBtn.classList.add('syncing');
  const _spinStart = Date.now();
  const overlay = !opts.silent && !opts.noOverlay; // 오버레이만 별도 제어 (동기화 작업 자체는 그대로)
  if (overlay) showLoading('동기화 중...');
  try {
    // 증분 판정: 노션 목록으로 '바뀐 하위/DB 페이지'만 추림. force면 전부, 목록 실패 시에도 전부.
    // headings(최상위 페이지 본문·헤딩·구조)는 항상 다시 받는다 — 헤딩 아래 본문 수정·삭제를 놓치지 않으려면 필요.
    // 속도는 엔트리 본문을 '바뀐 것만' 받는 것 + 병렬 로드로 확보(무거운 건 엔트리 쪽이라 이걸로 충분).
    let changed = null; // null=전부, Set=바뀐 엔트리 id만
    if (!opts.force) {
      try {
        const list = await notionFetch({ action: 'list' });
        const latest = {}; (list.pages || []).forEach(p => { if (p.id) latest[p.id] = p.lastEdited || ''; });
        changed = new Set();
        nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId)
             .forEach(n => { if (latest[n.entryNotionId] !== _pageEdited[n.entryNotionId]) changed.add(n.entryNotionId); });
        _pageEdited = { ..._pageEdited, ...latest }; _savePageEdited(); // 수정일 기준선 갱신
      } catch (e) { changed = null; }
    }
    // 바뀐(또는 전부) 엔트리 캐시만 제거 → _loadEntryNode가 그것만 새로 받고 나머지는 캐시 재사용
    if (!opts.silent) {
      nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId && (!changed || changed.has(n.entryNotionId)))
           .forEach(n => sessionStorage.removeItem(`snlog_entry_${n.entryNotionId}`));
    }
    // 헤딩(구조·헤딩 본문)은 항상 다시 받아 본문 수정·삭제까지 반영 — 위치는 syncPageIncremental이 보존
    const data = await notionFetch({ pageId, action: 'headings' });
    try { sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    const ghostId = 'ghost_' + pageId;
    if (nodeMap[ghostId]) { nodes = nodes.filter(n => n.id !== ghostId); edges = edges.filter(e => e.from !== ghostId && e.to !== ghostId); delete nodeMap[ghostId]; }
    const removed = syncPageIncremental(data.title || '추가 페이지', data.markdown || '', pageId);
    if (removed && removed.size && typeof pruneDetailTabs === 'function') pruneDetailTabs(removed);
    // [진단] 본문(desc)이 실제로 바뀐 노드 = 동기화가 반영한 것
    if (!opts.silent) {
      // 바뀐 엔트리(또는 전부)의 하위만 지우고 그 엔트리만 재로드 → 안 바뀐 subtree는 그대로(재배치 없음)
      const entryNodes = nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId);
      const targets = changed ? entryNodes.filter(n => changed.has(n.entryNotionId)) : entryNodes;
      const cleared = new Set();
      targets.forEach(n => _clearEntryDescendantsOf(n).forEach(id => cleared.add(id)));
      if (cleared.size && typeof pruneDetailTabs === 'function') pruneDetailTabs(cleared);
      for (const n of targets) { await _loadEntryNode(n, pageId); }
    }
    // 엔트리 본문까지 다시 로드한 뒤 패널 갱신 — 로드 전에 부르면 옛 내용으로 그려져 본문 수정/삭제가 안 보임
    if (typeof refreshOpenPanes === 'function') refreshOpenPanes();
  } catch(e) { /* 아래 finally에서 스핀 정지 */ } finally {
    if (overlay) hideLoading();
    // 동기화 끝날 때까지 계속 돌고, 너무 빨리 끝나면 최소 600ms는 보이게
    if (syncBtn) { const wait = Math.max(0, 600 - (Date.now() - _spinStart)); setTimeout(() => syncBtn.classList.remove('syncing'), wait); }
  }
}


function confirmRemoveLocalPage(pageId) {
  const el = document.querySelector(`[data-page-id="${pageId}"]`);
  const page = (window._sidebarPageList || []).find(p => p.id === pageId);
  const title = (page && page.title) ? page.title : '이 페이지';
  showConfirm('임시 페이지 삭제', `'${title}' 삭제.\n임시(로컬) 페이지는 복구 불가.`, () => removePage(pageId, el), true);
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
  _pruneEmptyFolderRows(); // 마지막 파일이 빠진 폴더 행은 목록에서 제거
  isStable = false; updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
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

// 페이지별 최종수정일 저장(증분 동기화용) — 하위·DB 항목 포함. 민감정보 아니라 항상 localStorage.
let _pageEdited = (() => { try { return JSON.parse(localStorage.getItem('snlog_page_edited') || '{}'); } catch (e) { return {}; } })();
function _savePageEdited() { try { localStorage.setItem('snlog_page_edited', JSON.stringify(_pageEdited)); } catch (e) {} }

function confirmBulkSync() { showConfirm('전체 동기화', '모든 페이지 다시 불러오기', bulkSync); }

// 전체 동기화: 모든 추가 페이지를 강제로 통째로 재요청. 증분은 페이지별 ↻이 담당.
async function bulkSync(opts) {
  opts = opts || {};
  const ids = [..._addedPageIds].filter(pid => !pid.startsWith('md_') && !pid.startsWith('local_'));
  const allBtn = document.querySelector('.sync-all'); // 상단 전체 동기화 버튼
  if (allBtn) allBtn.classList.add('syncing');
  const _spinStart = Date.now();
  try {
    // 수정일 기준선 갱신(다음 증분 비교용)
    try {
      const data = await notionFetch({ action: 'list' });
      const latest = {}; (data.pages || []).forEach(p => { if (p.id) latest[p.id] = p.lastEdited || ''; });
      _pageEdited = latest; _savePageEdited();
    } catch (e) {}
    // 한 페이지가 실패해도 나머지와 목록 갱신까지는 진행 (오버레이 없이 조용히)
    for (const pid of ids) { try { await syncPage(pid, { force: true, noOverlay: true }); } catch (e) {} }
    try { await syncMdFileHandles(); } catch (e) {}
    try { await syncFolderBatches(); } catch (e) {}
    // 노션 페이지 목록도 다시 받는다 — 새로 만든 페이지가 여기서 들어온다
    const added = await refreshSidebarPageList();
    if (!opts.silent) {
      toast(added > 0 ? `${ids.length}개 동기화 · 새 페이지 ${added}개` : `${ids.length}개 페이지 전체 동기화`,
        { type: 'success' });
    }
  } finally {
    if (allBtn) { const wait = Math.max(0, 600 - (Date.now() - _spinStart)); setTimeout(() => allBtn.classList.remove('syncing'), wait); }
  }
}
function confirmBulkClose() {
  showConfirm('전체 닫기', '추가된 모든 페이지 노드 제거.', () => {
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
    // 서식 마커는 그대로 둠 — 아래에서 평문 라벨(plainLabel)과 원문(labelMd)을 갈라 담는다
    let lbl = headerMatch[2].trim();

    let parentId = entryNode.id;
    for (let d = mdDepth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }

    let descLines = [], bodyBlocks = [], curBlk = null, nextIdx = i + 1;
    const flushBlk = () => { if (curBlk) { bodyBlocks.push({ id: curBlk.id, text: curBlk.lines.join('\n'), mark: curBlk.mark || '', type: curBlk.type || 'paragraph', checked: !!curBlk.checked }); curBlk = null; } };
    while (nextIdx < lines.length) {
      const rawNl = lines[nextIdx].replace(/\s+$/, '');
      const nl = rawNl.trim();
      if (!nl) { nextIdx++; continue; }
      if (nl.startsWith('#') || nl === '[CHILD_PAGE]' || nl === '[TGL]' || nl.startsWith('[NOTION_ENTRY:') || nl.startsWith('[BLOCK:')) break;
      const bbm = nl.match(/^\[BB:([a-f0-9]+)\]$/);
      if (bbm) { flushBlk(); curBlk = { id: bbm[1], lines: [] }; nextIdx++; continue; }
      if (descLines.join('\n').length > 3000) { nextIdx++; continue; }
      descLines.push(rawNl);
      if (curBlk) { if (!curBlk.lines.length) { curBlk.mark = _listMark(rawNl); curBlk.type = _blockTypeOf(rawNl); curBlk.checked = _blockChecked(rawNl); } curBlk.lines.push(bodyBlockText(rawNl)); }
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
      id, label: plainLabel(lbl), desc: cleanDesc(descLines.join('\n').substring(0, 5000)), date: '',
      x: entryNode.x + (Math.random()-0.5)*50, y: entryNode.y + (Math.random()-0.5)*50,
      vx: 0, vy: 0, level: graphLevel, fixed: false, color,
      _rgb: hexToRgb(color || '#74b9ff'),
      sourcePageId: entryNode.sourcePageId, visible: false, _frozen: false, _frozenFrames: 0
    };
    if (pendingEntryId) { n.entryNotionId = pendingEntryId; pendingEntryId = null; }
    if (pendingBlockId) { n.notionBlockId = pendingBlockId; n.notionParentId = pendingParentId; pendingBlockId = null; pendingParentId = null; }
    if (pendingToggle) { n.notionToggle = true; pendingToggle = false; }
    n.headingDepth = headerMatch[1].length;
    if (lbl && lbl !== n.label) n.labelMd = lbl; // 서식 있는 제목만 원문 보관(칩 표시용)
    if (bodyBlocks.length) n.bodyBlocks = bodyBlocks;
    if (pendingIsChildPage) { n.isChildPage = true; pendingIsChildPage = false; }
    nodes.push(n); nodeMap[id] = n;
    edges.push({ from: parentId, to: id });
    newIds.add(id);
    // 하위 페이지·DB 항목은 헤딩 스택에 넣지 않는다 — 넣으면 뒤에 오는 헤딩이 그 밑으로 딸려 들어간다
    if (!n.entryNotionId && !n.isChildPage) {
      currentParents[mdDepth] = id;
      for (let d = mdDepth + 1; d <= 5; d++) currentParents[d] = null;
    }
    if (nextIdx > i + 1) i = nextIdx - 1;
  }
  return newIds;
}

async function _loadEntryNode(node, pageId) {
  if (!_addedPageIds.has(pageId)) return;
  const cacheKey = `snlog_entry_${node.entryNotionId}`;
  let md = sessionStorage.getItem(cacheKey);
  if (!md) {
    // rate limit(429)·일시 오류로 조용히 누락되던 문제 → 백오프 재시도(요청 성공하면 내용 비어도 통과)
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const data = await notionFetch({ pageId: node.entryNotionId, action: 'entry' });
        md = data.markdown || '';
        if (md) try { sessionStorage.setItem(cacheKey, md); } catch(e) {}
        ok = true;
      } catch(e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    if (!ok) return; // 3번 다 실패
  }
  if (!md) return; // 성공했지만 내용 없음
  // 요청이 오가는 동안 페이지를 닫았을 수 있다 — 시작부 검사만으론 이미 날아간 요청을 못 막는다
  if (!_addedPageIds.has(pageId)) return;
  const newIds = _addEntryChildNodes(node, md);
  // 엔트리(하위 페이지·DB 항목) 자신의 본문 = 첫 헤딩 전까지의 줄.
  // 예전엔 이 계산이 '헤딩이 하나도 없을 때'에만 돌아서, 페이지 안에 헤딩이 하나라도 있으면
  // 그 페이지에 쓴 글이 통째로 화면에서 사라졌다(헤딩 아래 내용만 자식 노드로 보였음).
  const own = _entryOwnBody(md, newIds.size > 0);
  if (own.desc || own.blocks.length) {
    node.desc = own.desc;
    if (own.blocks.length) node.bodyBlocks = own.blocks;
  }
  if (newIds.size > 0) {
    // 새로 추가된 자식 + 이 엔트리만 물리 해제 — 이미 자리 잡은 다른 노드는 그대로 둠(재배치 방지)
    newIds.forEach(id => { const nn = nodeMap[id]; if (nn) { nn.visible = true; nn._frozen = false; nn._frozenFrames = 0; } });
    if (node) { node._frozen = false; node._frozenFrames = 0; }
    isStable = false;
    const nestedChildPages = [...newIds].map(id => nodeMap[id]).filter(n => n?.entryNotionId);
    for (const child of nestedChildPages) await _loadEntryNode(child, pageId);
  }
}

// 엔트리 마크다운에서 '그 페이지 자신의 본문'을 뽑는다.
// leadOnly=true(아래에 헤딩 노드가 생긴 경우)면 첫 헤딩/구조 마커 전까지만 — 그 뒤는 자식 노드 몫이다.
function _entryOwnBody(md, leadOnly) {
  const blocks = [], descArr = [];
  let cur = null;
  const flush = () => { if (cur) { blocks.push({ id: cur.id, text: cur.lines.join('\n'), mark: cur.mark || '', type: cur.type || 'paragraph', checked: !!cur.checked }); cur = null; } };
  for (const raw of md.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (leadOnly && /^#{1,5}\s/.test(t)) break;
    const m = t.match(/^\[BB:([a-f0-9]+)\]$/);
    if (m) { flush(); cur = { id: m[1], lines: [] }; continue; }
    if (/^\[(?:BLOCK|NOTION_ENTRY|DB_NODE|CHILD_PAGE|TGL)[^\]]*\]$/.test(t)) { flush(); if (leadOnly) break; continue; }
    descArr.push(raw.replace(/^#{1,5}\s+/, ''));
    if (cur) { if (!cur.lines.length) { cur.mark = _listMark(raw); cur.type = _blockTypeOf(raw); cur.checked = _blockChecked(raw); } cur.lines.push(bodyBlockText(raw)); }
  }
  flush();
  return { desc: cleanDesc(descArr.join('\n').substring(0, 5000).trim()), blocks };
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

  // 동시 4개씩 병렬 로드(공유 인덱스에서 하나씩 꺼내는 워커 풀). JS 단일 스레드라 노드 추가는 원자적 → 경합 없음.
  const CONCURRENCY = 3; // 노션 rate limit(초당 ~3) 여유 — 초과분은 _loadEntryNode 재시도로 커버
  let _i = 0;
  const worker = async () => {
    while (_i < entryNodes.length) {
      const node = entryNodes[_i++];
      if (!_addedPageIds.has(pageId)) break; // 닫혔으면 남은 항목은 요청조차 하지 않는다
      await _loadEntryNode(node, pageId);
      loaded++; setTag(`로딩 ${loaded}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entryNodes.length) }, worker));

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
      const markdown = normalizeNotionMd(e.target.result); // 노션 내보내기 속성·이스케이프 정리
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

// ── 페이지 추가 메뉴(＋) ────────────────────────────────────────────
// 아이콘 4개가 입력창을 잠식해 ＋ 하나로 접었다. 바깥을 누르면 닫힌다.
function togglePageAddMenu() {
  const menu = document.getElementById('page-add-menu');
  if (!menu) return;
  if (menu.classList.contains('open')) { closePageAddMenu(); return; }
  menu.classList.add('open');
  document.getElementById('page-add-btn')?.classList.add('open');
  setTimeout(() => document.addEventListener('mousedown', _pageAddOutside), 0);
}
function closePageAddMenu() {
  document.getElementById('page-add-menu')?.classList.remove('open');
  document.getElementById('page-add-btn')?.classList.remove('open');
  document.removeEventListener('mousedown', _pageAddOutside);
}
function _pageAddOutside(e) {
  if (e.target.closest && e.target.closest('#page-add-menu, #page-add-btn')) return;
  closePageAddMenu();
}
function _pageAddRun(fn) { closePageAddMenu(); if (typeof fn === 'function') fn(); }

// ── 마크다운 붙여넣기 ───────────────────────────────────────────────
function openMdPaste() {
  const modal = document.getElementById('md-paste-modal');
  if (!modal) return;
  modal.classList.add('open');
  const ta = document.getElementById('md-paste-text');
  if (ta) { ta.value = ''; ta.focus(); }
  const ti = document.getElementById('md-paste-title');
  if (ti) ti.value = '';
}
function closeMdPaste() {
  const modal = document.getElementById('md-paste-modal');
  if (modal) modal.classList.remove('open');
}
function addPastedMarkdown() {
  const ti = document.getElementById('md-paste-title');
  const title = (ti ? ti.value : '').trim();
  // 제목은 필수 — 본문 첫 헤딩을 제목으로 삼으면 그 헤딩 노드가 통째로 사라진다
  if (!title) { toast('페이지 제목 입력', { type: 'error' }); if (ti) ti.focus(); return; }
  const ta = document.getElementById('md-paste-text');
  const md = normalizeNotionMd(ta ? ta.value : '');
  if (!md.trim()) { toast('마크다운 내용 입력', { type: 'error' }); if (ta) ta.focus(); return; }
  closeMdPaste();
  const root = addMarkdownPage(title, md);
  savePageList();
  const cnt = nodes.filter(n => root && n.sourcePageId === root.sourcePageId).length;
  toast(`"${title}" 추가됨 · 노드 ${cnt}개`, { type: 'success' });
  setTimeout(() => { try { fitGraph(true); } catch (e) {} }, 300);
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
