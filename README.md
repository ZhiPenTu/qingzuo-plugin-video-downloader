# Qingzuo 短视频去水印下载插件

解析抖音、快手、视频号分享链接并保存无水印视频，也可以从当前浏览器页面检测并批量下载媒体。

插件只申请解析服务和常见媒体 CDN 的受控网络权限。解析请求由 `video.zacao.top` 提供，匿名请求按 IP 每小时限 30 次。保存按钮优先读取解析服务提供的视频流，再交给轻作的私有文件令牌和系统保存对话框。解析服务不可用、额度用尽或视频直链过期时，需要稍后重试或重新解析。图文作品暂不支持视频保存。

请只保存你有权使用的内容。插件不保存分享文案和解析结果，也不把用户凭据发送给平台。

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

`npm run pack` 只生成当前平台的 `.ecplugin` 和目录片段；跨平台制品、签名和市场目录由独立发布流程处理。
