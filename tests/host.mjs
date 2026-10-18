import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { launchPluginTestHost } from '@commerce/plugin-sdk/testing';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const platform = process.platform + '-' + process.arch;
if (!process.env.QINGZUO_HOST_EXECUTABLE) throw new Error('Pinned platform executable required.');
const host = await launchPluginTestHost({
  executablePath: process.env.QINGZUO_HOST_EXECUTABLE,
  artifactPath: `release/${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`,
  pluginId: pkg.commerce.id
});
try {
  await host.plugin.locator('#share-text').fill('复制打开抖音 https://v.douyin.com/fixture/');
  await expect(host.plugin.locator('#parse')).toBeEnabled();
  await expect(host.plugin.locator('#save')).toBeDisabled();
  await expect(host.plugin.getByRole('heading', { name: '检测结果', exact: true })).toBeVisible();
  await expect(host.plugin.locator('#browser-list')).toContainText('打开一个包含视频或图片的页面');
  console.log('Video downloader plugin host loaded and validated its initial paste-to-parse state.');
} finally {
  await host.close();
}
