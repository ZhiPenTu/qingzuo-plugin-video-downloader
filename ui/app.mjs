import { createPluginClient } from './sdk.mjs';
import { downloadVideo, parseVideo } from './video-parser.mjs';

const client = createPluginClient();
const bridge = globalThis.commercePlugin;
const $ = id => document.getElementById(id);
let current = null;
let file = null;
let busy = false;

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
updateControls();
