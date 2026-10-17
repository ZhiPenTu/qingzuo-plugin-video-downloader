# AGENTS.md

本仓库是轻作独立 `official.video-downloader` 插件，负责解析用户提供的抖音、快手和蝴蝶号 / 视频号分享链接并保存视频。桌面底座、市场签名和目录发布在其他仓库完成。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

不要提交 `node_modules/`、`release/`、`output/`、`.env*` 或任何用户链接和真实媒体文件。`npm run pack` 只生成本地验收制品。

## 实现约定

- 解析和下载请求必须通过 SDK `client.network.request()`，只访问清单声明的解析服务和媒体 CDN；不得在 UI 中使用 `fetch`、代理或系统网络。
- 结果先进入 SDK 文件令牌，再调用 `client.files.save()`；不得把视频字节、完整分享文案或临时令牌写入日志。
- 解析服务返回的直链可能过期；不自动重试，不保存历史链接。取消、HTTP 错误、无媒体结果和无效协议都要清晰反馈。
- 只接受抖音、快手和蝴蝶号 / 视频号分享域名，避免把任意地址发送给解析服务。
- UI 文案只保留用户需要的操作提示；版权与使用范围提示保持简短。
