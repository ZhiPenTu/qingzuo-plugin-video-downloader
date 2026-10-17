import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParseUrl, buildProxyUrl, detectPlatform, downloadVideo, parseVideoResponse, validateShareText } from '../ui/video-parser.mjs';

function encoded(value) { return Buffer.from(JSON.stringify(value)).toString('base64'); }

test('accepts supported share text and keeps the parser request encoded', () => {
  const input = '复制打开抖音 https://v.douyin.com/abc123/ 朋友看看';
  const validated = validateShareText(input);
  assert.equal(validated.platform, '抖音');
  assert.equal(detectPlatform(validated.url), '抖音');
  const request = new URL(buildParseUrl(input));
  assert.equal(request.origin, 'https://mp.cenguigui.cn');
  assert.equal(request.pathname, '/api.php');
  assert.equal(request.searchParams.get('url'), input);
  assert.throws(() => validateShareText('https://example.com/video'), /抖音、快手/);
});

test('normalizes the aggregate response and supports the video channel label', () => {
  const result = parseVideoResponse({ status: 200, data: encoded({ code: 200, platform: '视频号', data: {
    video_url: 'https://video.qq.com/media/example.mp4', title: '测试视频', author: { nickname: '作者' }, cover_url: 'https://qpic.cn/cover.jpg'
  } }) }, { platform: '蝴蝶号 / 视频号', url: 'https://channels.weixin.qq.com/s/example' });
  assert.deepEqual(result, {
    videoUrl: 'https://video.qq.com/media/example.mp4', platform: '视频号', title: '测试视频', author: '作者', coverUrl: 'https://qpic.cn/cover.jpg', sourceUrl: 'https://channels.weixin.qq.com/s/example'
  });
  assert.equal(buildProxyUrl(result.videoUrl), 'https://mp.cenguigui.cn/api.php?action=proxy&u=' + encodeURIComponent(result.videoUrl));
});

test('maps service errors and rejects missing or unsafe media', () => {
  for (const [code, message] of [[401, /访问密钥/], [402, /额度/], [404, /不支持|删除/], [429, /频繁/]]) {
    assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code, msg: 'fixture' }) }), message);
  }
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: {} }) }), /视频/);
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: { video_url: 'http://insecure.example/video.mp4' } }) }), /不安全/);
  assert.throws(() => validateShareText('没有链接'), /有效的分享链接/);
});

test('downloads through the same-origin proxy and releases failed files', async () => {
  const calls = [];
  const client = { network: { request: async options => { calls.push(options); return { status: 200, mime: 'video/mp4', file: { token: 'video-token', name: '测试视频.mp4', size: 123 } }; } }, files: { release: async token => calls.push({ release: token }) } };
  const file = await downloadVideo(client, { title: '测试视频', videoUrl: 'https://v3-web.douyinvod.com/video.mp4' });
  assert.equal(file.token, 'video-token');
  assert.equal(new URL(calls[0].url).origin, 'https://mp.cenguigui.cn');
  assert.equal(new URL(calls[0].url).searchParams.get('action'), 'proxy');
  assert.equal(calls[0].responseType, 'file');

  const failing = { network: { request: async () => ({ status: 500, mime: 'application/json', file: { token: 'error-token', size: 10 } }) }, files: { release: async token => calls.push({ release: token }) } };
  await assert.rejects(downloadVideo(failing, { title: '失败', videoUrl: 'https://v.kwaicdn.com/video.mp4' }), /解析服务未完成处理/);
  assert.ok(calls.some(entry => entry.release === 'error-token'));
});
