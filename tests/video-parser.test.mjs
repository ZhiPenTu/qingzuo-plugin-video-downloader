import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParseUrl, detectPlatform, downloadVideo, parseVideo, parseVideoResponse, validateShareText } from '../ui/video-parser.mjs';

function encoded(value) { return Buffer.from(JSON.stringify(value)).toString('base64'); }

test('accepts supported share text and keeps the parser request encoded', () => {
  const input = '复制打开抖音 https://v.douyin.com/abc123/;6pm oDU:/ 朋友看看';
  const validated = validateShareText(input);
  assert.equal(validated.platform, '抖音');
  assert.equal(detectPlatform(validated.url), '抖音');
  const request = new URL(buildParseUrl(input));
  assert.equal(request.origin, 'https://video.zacao.top');
  assert.equal(request.pathname, '/api/parse/v2');
  assert.equal(request.searchParams.get('url'), validated.url);
  assert.throws(() => validateShareText('https://example.com/video'), /抖音、快手/);
});

test('normalizes the parser response and prefers its stream proxy for downloads', () => {
  const stream = '/api/video/stream?url=' + encodeURIComponent('https://v26-dy.ixigua.com/media.mp4');
  const result = parseVideoResponse({ status: 200, data: encoded({ code: 200, succ: true, message: '成功', data: {
    platform: '抖音', media_type: 'video', type: 1,
    video_url: 'https://v26-dy.ixigua.com/media.mp4', streamUrl: stream,
    title: '测试视频', author: { nickname: '作者' }, cover_url: 'https://p3-sign.douyinpic.com/cover.jpg'
  } }) }, { platform: '抖音', url: 'https://v.douyin.com/abc123/' });
  assert.deepEqual(result, {
    videoUrl: 'https://v26-dy.ixigua.com/media.mp4',
    downloadUrl: 'https://video.zacao.top' + stream,
    platform: '抖音',
    title: '测试视频',
    author: '作者',
    coverUrl: 'https://p3-sign.douyinpic.com/cover.jpg',
    sourceUrl: 'https://v.douyin.com/abc123/'
  });
});

test('supports the video channel label and direct media fallback', () => {
  const result = parseVideoResponse({ status: 200, data: encoded({ code: 200, succ: true, data: {
    platform: '视频号', video_url: 'https://video.qq.com/media/example.mp4', type: 'video', title: '测试视频', author: { nickname: '作者' }, cover_url: 'https://qpic.cn/cover.jpg'
  } }) }, { platform: '蝴蝶号 / 视频号', url: 'https://channels.weixin.qq.com/s/example' });
  assert.equal(result.videoUrl, 'https://video.qq.com/media/example.mp4');
  assert.equal(result.downloadUrl, 'https://video.qq.com/media/example.mp4');
  assert.equal(result.platform, '视频号');
  assert.equal(result.sourceUrl, 'https://channels.weixin.qq.com/s/example');
});

test('maps service errors and rejects missing or unsafe media', () => {
  for (const [code, message] of [[401, /访问密钥/], [402, /额度/], [403, /无法访问/], [404, /失效|删除/], [429, /频繁/]]) {
    assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code, msg: 'fixture' }) }), message);
  }
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 502, message: '链接不可访问', data: null, succ: false }) }), /链接已失效/);
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: {} }) }), /视频/);
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: { type: 0, image_list: ['https://example.com/image.jpg'] } }) }), /图文作品/);
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: { video_url: 'http://insecure.example/video.mp4' } }) }), /不安全/);
  assert.throws(() => parseVideoResponse({ status: 200, data: encoded({ code: 200, data: { video_url: 'https://example.com/video.mp4' } }) }), /暂不支持/);
  assert.throws(() => validateShareText('没有链接'), /有效的分享链接/);
});

test('maps transport failures to actionable messages', async () => {
  const client = { network: { request: async () => { throw new Error('网络请求未完成，请检查连接或服务配置。'); } } };
  await assert.rejects(parseVideo(client, 'https://v.douyin.com/abc123/'), /解析服务暂时无法连接/);
  await assert.rejects(downloadVideo(client, { title: '测试', videoUrl: 'https://video.qq.com/media/example.mp4' }), /视频下载未完成/);
});

test('downloads through the parser stream and releases failed files', async () => {
  const calls = [];
  const client = { network: { request: async options => { calls.push(options); return { status: 200, mime: 'video/mp4', file: { token: 'video-token', name: '测试视频.mp4', size: 123 } }; } }, files: { release: async token => calls.push({ release: token }) } };
  const file = await downloadVideo(client, {
    title: '测试视频',
    videoUrl: 'https://v26-dy.ixigua.com/video.mp4',
    downloadUrl: 'https://video.zacao.top/api/video/stream?url=https%3A%2F%2Fv26-dy.ixigua.com%2Fvideo.mp4'
  });
  assert.equal(file.token, 'video-token');
  assert.equal(new URL(calls[0].url).origin, 'https://video.zacao.top');
  assert.equal(calls[0].responseType, 'file');

  const failing = { network: { request: async () => ({ status: 500, mime: 'application/json', file: { token: 'error-token', size: 10 } }) }, files: { release: async token => calls.push({ release: token }) } };
  await assert.rejects(downloadVideo(failing, { title: '失败', videoUrl: 'https://v.kwaicdn.com/video.mp4' }), /解析服务暂时不可用/);
  assert.ok(calls.some(entry => entry.release === 'error-token'));
});
