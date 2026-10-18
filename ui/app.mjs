import { createPluginClient } from './sdk.mjs';
import { downloadVideo, parseVideo } from './video-parser.mjs';

const client = createPluginClient();
const bridge = globalThis.commercePlugin;
const $ = id => document.getElementById(id);
let current = null;
let file = null;
let busy = false;
let browserBusy = false;
let browserStatus = { open: false, activeTabId: null, tabs: [], candidates: [], downloads: [] };
let browserError = '';
let selectedBrowserCandidates = new Set();
let browserRefreshPromise = null;

function message(value, error = false) {
  $('status').textContent = value;
  $('status').classList.toggle('error', error);
}

function updateControls() {
  $('share-text').disabled = busy;
  $('parse').disabled = busy || !$('share-text').value.trim();
  $('cancel').disabled = !busy;
  $('save').disabled = busy || !current;
}

function browserTaskFor(candidateId) {
  return [...(browserStatus.downloads || [])].reverse().find(task => task.candidateId === candidateId);
}

function activeBrowserCandidates() {
  return (browserStatus.candidates || []).filter(candidate => candidate.tabId === browserStatus.activeTabId);
}

function browserMessage(error) {
  browserError = error ? (error.message || '浏览器检测暂时不可用。') : '';
  renderBrowser();
}

function createBrowserButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.disabled = browserBusy;
  button.onclick = () => void handler();
  return button;
}

function renderBrowser() {
  const candidates = activeBrowserCandidates();
  const ready = candidates.filter(candidate => candidate.status === 'ready');
  const allSelected = ready.length > 0 && ready.every(candidate => selectedBrowserCandidates.has(candidate.id));
  const summary = $('browser-summary');
  const list = $('browser-list');
  const selectAll = $('browser-select-all');
  const batch = $('browser-batch-download');
  const rescan = $('browser-rescan');
  if (!summary || !list || !selectAll || !batch || !rescan) return;

  summary.textContent = candidates.length ? `${candidates.length} 项媒体` : (browserStatus.open ? '滚动页面后自动检测' : '打开右侧浏览器后自动检测');
  selectAll.checked = allSelected;
  selectAll.disabled = !ready.length || browserBusy;
  selectAll.onchange = () => {
    selectedBrowserCandidates = allSelected ? new Set() : new Set(ready.map(candidate => candidate.id));
    renderBrowser();
  };
  batch.disabled = !selectedBrowserCandidates.size || browserBusy;
  batch.onclick = () => void downloadBrowserCandidates([...selectedBrowserCandidates], 'batch');
  rescan.disabled = browserBusy || !browserStatus.activeTabId;
  rescan.onclick = () => void refreshBrowserStatus(true);

  const valid = new Set(ready.map(candidate => candidate.id));
  selectedBrowserCandidates = new Set([...selectedBrowserCandidates].filter(id => valid.has(id)));
  list.replaceChildren();
  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'browser-empty';
    empty.textContent = '打开一个包含视频或图片的页面，检测结果会显示在这里。';
    list.append(empty);
  }
  for (const candidate of candidates) {
    const task = browserTaskFor(candidate.id);
    const downloading = task && ['queued', 'downloading'].includes(task.status);
    const article = document.createElement('article');
    article.className = `browser-candidate-item${candidate.status === 'unresolved' ? ' is-unresolved' : ''}`;
    article.setAttribute('role', 'listitem');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selectedBrowserCandidates.has(candidate.id);
    check.disabled = candidate.status !== 'ready' || browserBusy;
    check.onchange = () => {
      if (check.checked) selectedBrowserCandidates.add(candidate.id);
      else selectedBrowserCandidates.delete(candidate.id);
      renderBrowser();
    };
    const checkLabel = document.createElement('label');
    checkLabel.className = 'browser-candidate-check';
    checkLabel.append(check);

    const thumb = document.createElement('div');
    thumb.className = 'browser-candidate-thumb';
    if (candidate.thumbnailUrl) {
      const image = document.createElement('img');
      image.src = candidate.thumbnailUrl;
      image.alt = '';
      thumb.append(image);
    } else {
      thumb.textContent = candidate.type === 'video' ? '视频' : '图片';
    }

    const info = document.createElement('div');
    info.className = 'browser-candidate-info';
    const title = document.createElement('strong');
    title.textContent = candidate.title || (candidate.type === 'video' ? '视频' : '图片');
    title.title = title.textContent;
    info.append(title);
    const note = document.createElement('span');
    note.className = 'browser-candidate-note';
    if (candidate.status === 'unresolved' || candidate.status === 'expired') {
      note.textContent = candidate.reason || (candidate.status === 'expired' ? '链接已过期，请重新扫描。' : '需要打开详情或重新扫描。');
    } else if (task?.status === 'failed') {
      note.className += ' is-error';
      note.textContent = task.error || '下载失败，请重试。';
    } else if (downloading) {
      note.textContent = task.status === 'queued' ? '排队中' : `下载中 ${task.progress}%`;
    } else if (task?.status === 'completed') {
      note.className += ' is-done';
      note.textContent = task.filename ? `已保存：${task.filename}` : '已保存';
    }
    if (note.textContent) info.append(note);
    if (downloading) {
      const progress = document.createElement('div');
      progress.className = 'browser-progress';
      const bar = document.createElement('span');
      bar.style.width = `${task.progress}%`;
      progress.append(bar);
      info.append(progress);
    }

    const actions = document.createElement('div');
    actions.className = 'browser-candidate-actions';
    if (downloading) {
      actions.append(createBrowserButton('取消', 'secondary small-button', () => cancelBrowserDownload(task.id)));
    } else if (candidate.status === 'ready') {
      actions.append(createBrowserButton(task?.status === 'failed' ? '重试' : '下载', 'secondary small-button', () => downloadBrowserCandidates([candidate.id], 'single')));
    }
    article.append(checkLabel, thumb, info, actions);
    list.append(article);
  }
  const status = $('browser-status');
  status.textContent = browserError;
  status.classList.toggle('error', Boolean(browserError));
}

async function refreshBrowserStatus(rescan = false) {
  if (browserRefreshPromise) return browserRefreshPromise;
  browserRefreshPromise = (async () => {
    try {
      browserStatus = rescan ? await client.browser.rescan(browserStatus.activeTabId || undefined) : await client.browser.status();
      browserError = '';
      renderBrowser();
    } catch (error) {
      browserMessage(error);
    }
  })().finally(() => { browserRefreshPromise = null; });
  return browserRefreshPromise;
}

async function downloadBrowserCandidates(candidateIds, mode) {
  if (!candidateIds.length || browserBusy) return;
  browserBusy = true;
  renderBrowser();
  try {
    browserStatus = await client.browser.download({ candidateIds, mode });
    browserError = '';
  } catch (error) {
    browserMessage(error);
  } finally {
    browserBusy = false;
    renderBrowser();
  }
}

async function cancelBrowserDownload(id) {
  if (!id || browserBusy) return;
  browserBusy = true;
  renderBrowser();
  try {
    browserStatus = await client.browser.cancel(id);
    browserError = '';
  } catch (error) {
    browserMessage(error);
  } finally {
    browserBusy = false;
    renderBrowser();
  }
}

function clearResult() {
  current = null;
  $('result-panel').hidden = true;
  $('platform').textContent = '';
  $('title').textContent = '';
  $('author').textContent = '';
  $('open-link').hidden = true;
  $('open-link').removeAttribute('href');
}

$('share-text').oninput = updateControls;

$('parse').onclick = async () => {
  busy = true;
  clearResult();
  if (file) { await client.files.release(file.token).catch(() => {}); file = null; }
  updateControls();
  message('正在解析链接…');
  try {
    current = await parseVideo(client, $('share-text').value);
    $('platform').textContent = current.platform;
    $('title').textContent = current.title;
    $('author').textContent = '作者：' + current.author;
    $('result-panel').hidden = false;
    $('open-link').href = current.videoUrl;
    $('open-link').hidden = false;
    message('解析完成，可以保存视频。');
  } catch (error) {
    current = null;
    message(error.message || '解析失败，请稍后重试。', true);
  } finally {
    busy = false;
    updateControls();
  }
};

$('cancel').onclick = async () => {
  try { await bridge.invoke('tasks.cancel', { id: 'video-parse' }); } catch { /* request may already be complete */ }
  busy = false;
  message('已取消解析。');
  updateControls();
};

$('save').onclick = async () => {
  if (!current || busy) return;
  busy = true;
  updateControls();
  message('正在准备视频…');
  try {
    if (file) await client.files.release(file.token).catch(() => {});
    file = await downloadVideo(client, current);
    const saved = await client.files.save(file.token, file.name);
    message(saved ? '视频已保存。' : '已取消保存。');
  } catch (error) {
    message(error.message || '视频保存失败，请稍后重试。', true);
  } finally {
    if (file) { await client.files.release(file.token).catch(() => {}); file = null; }
    busy = false;
    updateControls();
  }
};

client.onDispose(() => { if (file) void client.files.release(file.token).catch(() => {}); });
const unsubscribeBrowser = client.browser.onEvent(() => { void refreshBrowserStatus(); });
client.onDispose(() => unsubscribeBrowser());
renderBrowser();
void refreshBrowserStatus();
updateControls();
