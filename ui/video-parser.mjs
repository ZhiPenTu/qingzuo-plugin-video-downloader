export const PARSER_ORIGIN = 'https://mp.cenguigui.cn';
export const PARSER_URL = PARSER_ORIGIN + '/api.php';

const PLATFORM_HOSTS = [
  { name: '抖音', patterns: [/\.douyin\.com$/i, /\.iesdouyin\.com$/i, /\.douyinvod\.com$/i, /\.douyinpic\.com$/i, /\.365yg\.com$/i] },
  { name: '快手', patterns: [/\.kuaishou\.com$/i, /\.kwai\.com$/i, /\.ksurl\.cn$/i, /\.kwaicdn\.com$/i] },
  { name: '蝴蝶号 / 视频号', patterns: [/(^|\.)channels\.weixin\.qq\.com$/i, /(^|\.)weixin\.qq\.com$/i, /(^|\.)wx\.qq\.com$/i, /(^|\.)video\.qq\.com$/i, /(^|\.)qpic\.cn$/i] }
];

function cleanUrlCandidate(value) {
  return value.replace(/[\u3000\s]+$/g, '').replace(/[，。！？；：、）》】」』,.!?;:)\]}]+$/g, '');
}

export function extractShareUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/https?:\/\/[^\s<>"'“”‘’]+/i);
  if (!match) return null;
  try {
    const url = new URL(cleanUrlCandidate(match[0]));
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function detectPlatform(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  return PLATFORM_HOSTS.find(platform => platform.patterns.some(pattern => pattern.test(host)))?.name ?? null;
}

export function validateShareText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请粘贴视频分享链接。');
  const text = value.trim();
  if (text.length > 2000) throw new Error('分享文案不能超过 2000 个字符。');
  const url = extractShareUrl(text);
  if (!url) throw new Error('没有找到有效的分享链接。');
  const platform = detectPlatform(url);
  if (!platform) throw new Error('请粘贴抖音、快手或蝴蝶号 / 视频号分享链接。');
  return { text, url, platform };
}

export function buildParseUrl(value) {
  const { text } = validateShareText(value);
  return PARSER_URL + '?url=' + encodeURIComponent(text);
}

export function buildProxyUrl(videoUrl) {
  let url;
  try { url = new URL(videoUrl); } catch { throw new Error('解析结果中的视频地址无效。'); }
  if (url.protocol !== 'https:') throw new Error('解析结果中的视频地址不安全。');
  return PARSER_URL + '?action=proxy&u=' + encodeURIComponent(url.href);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function responseJson(response) {
  if (!response || typeof response.data !== 'string') throw new Error('解析服务返回了无效响应。');
  try { return JSON.parse(decodeBase64(response.data)); } catch { throw new Error('解析服务返回了无效 JSON。'); }
}

function serviceError(code, message, httpStatus) {
  const number = Number(code || httpStatus || 0);
  if (number === 401) return new Error('解析服务需要有效的访问密钥。');
  if (number === 402) return new Error('解析服务额度不足。');
  if (number === 404) return new Error('链接暂不支持，或视频已删除 / 设为私密。');
  if (number === 429) return new Error('解析请求过于频繁，请稍后手动重试。');
  if (number === 400 || number === 203 || number === 204) return new Error(message || '没有找到可下载的视频。');
  return new Error(message || (httpStatus ? `解析服务未完成处理（${httpStatus}）。` : '没有找到可下载的视频。'));
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() ?? null;
}

function normalizeAuthor(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return null;
  return firstString(value.nickname, value.name, value.author, value.unique_id);
}

export function parseVideoResponse(response, input = {}) {
  if (!response || response.status < 200 || response.status >= 300) {
    let message = null;
    try { message = responseJson(response)?.msg ?? null; } catch { /* use the HTTP status */ }
    throw serviceError(response?.status, message, response?.status);
  }
  const payload = responseJson(response);
  const code = payload?.code ?? payload?.status_code ?? payload?.data?.code;
  const data = payload?.data ?? payload?.result ?? payload;
  const message = firstString(payload?.msg, payload?.message, data?.msg);
  if (payload?.ok === false || (code !== undefined && Number(code) !== 200 && !data?.video_url && !data?.video && !data?.url)) {
    throw serviceError(code, message, response.status);
  }
  const videoUrl = firstString(data?.video_url, data?.video, data?.url, data?.proxy_url);
  if (!videoUrl) throw new Error(message || '没有找到可下载的视频。');
  let parsedUrl;
  try { parsedUrl = new URL(videoUrl); } catch { throw new Error('解析服务返回了无效的视频地址。'); }
  if (parsedUrl.protocol !== 'https:') throw new Error('解析服务返回了不安全的视频地址。');
  const platform = firstString(data?.platform, payload?.platform) || input.platform || '短视频';
  return {
    videoUrl: parsedUrl.href,
    platform,
    title: firstString(data?.title, data?.desc, data?.description) || '短视频',
    author: normalizeAuthor(data?.author) || '未知作者',
    coverUrl: firstString(data?.cover_url, data?.cover, data?.thumbnail),
    sourceUrl: firstString(data?.source_url, data?.url) || input.url || null
  };
}

export async function parseVideo(client, value) {
  const input = validateShareText(value);
  const response = await client.network.request({ url: buildParseUrl(input.text), method: 'GET', responseType: 'data', taskId: 'video-parse' });
  return parseVideoResponse(response, input);
}

function safeFilename(value) {
  const normalized = String(value || '短视频').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (normalized || '短视频').slice(0, 72) + '.mp4';
}

export async function downloadVideo(client, result) {
  if (!result?.videoUrl) throw new Error('没有可下载的视频。');
  const response = await client.network.request({
    url: buildProxyUrl(result.videoUrl),
    method: 'GET',
    responseType: 'file',
    filename: safeFilename(result.title),
    taskId: 'video-download'
  });
  if (response.status < 200 || response.status >= 300) {
    await client.files.release(response.file.token).catch(() => {});
    throw serviceError(response.status, null, response.status);
  }
  if (!response.file?.token || !response.file.size) {
    if (response.file?.token) await client.files.release(response.file.token).catch(() => {});
    throw new Error('下载服务没有返回视频文件。');
  }
  if (/^(text\/|application\/json)/i.test(response.mime || '')) {
    await client.files.release(response.file.token).catch(() => {});
    throw new Error('下载服务没有返回视频文件。');
  }
  return response.file;
}
