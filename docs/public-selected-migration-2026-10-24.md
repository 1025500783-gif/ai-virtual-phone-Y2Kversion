# 公开候选迁移记录 · 2026-10-24

基准为公开 1.1.1 / 3815203，候选分支 codex/public-selected-oct24。当前仅为本地候选，没有提交、推送、部署或改版本号。

## 本次范围

1. 经典/玻璃输入栏：透明仅发送、聚焦空内容触发回复、图标及提示字精修。
2. 重试版本：原文/前后版本、分支重试、取消保留选中版本、失败恢复与档案清理/备份。
3. 可选合并悬浮工具：提示词查看器、作用域 API/世界书、快捷导航、拖动位置与新旧入口互斥。
4. 用户资料与头像：聊天/档案头像分离、活动头像统一回退、可选肖像；肖像处理与日历/普通图片动作分离。
5. 预设管理：参数发送开关、OR 适用范围、分组/排序/多选、导入导出与对应请求链路。
6. 语音与翻译：表达标签与历史处理、朗读兜底、会话引文翻译及专名去重。
7. 其他设置：API 复制/模型排序、数据管理视觉、相册默认图标入口。

音乐页面和一起听增强暂不迁入；保留本版本已有音乐/一起听实现。其他未选模块也不随共享文件整体迁入。

## 工程与验证

- 新重试键注册在聊天数据模块，按身份/会话保存；版本切换不重放模型、工具或插件动作。
- 悬浮工具适配既有 Story 与旧线下请求作用域，缓存的其他会话不能覆盖当前绑定。
- 肖像处理检查请求图片、身份、原图及取消状态；流式元数据不显示到聊天正文。
- 独立应用源码严格类型检查、72 页生产构建及产物 backdrop-filter 恢复通过。构建配置会跳过 lint/类型，独立类型检查另行执行，没有 lint 通过声明。
- 25 个不同专项脚本覆盖重试、实际预设/供应商构造、微信分发、头像、语音、真实 IndexedDB 备份恢复、身份隔离、KV 水合、相册/钱包及原有音乐/一起听；手机框桥接在双内核验证。
- 生产页面 Chromium/WebKit 验证输入栏/重试、资料与预设、悬浮工具，含 320/390 宽度、日夜、菜单展开及键盘操作。仅使用合成资料和拦截响应。

## 复测入口

使用已安装的 Playwright 及浏览器。可通过 PLAYWRIGHT_MODULE、NODE_PATH、CHAT_TEST_BROWSER 指定测试依赖与 Chromium 程序；WebKit 需要另安装对应运行时。

```text
node scripts/check-public-selected-browser.cjs
node scripts/check-public-settings-browser.cjs
node scripts/check-public-floating-browser.cjs
node scripts/check-public-performance.cjs
node scripts/check-chat-retry-versions.cjs
node scripts/check-preset-controls.cjs
node scripts/check-identity-backup.cjs
```

最终性能原表见 public-selected-performance-2026-10-24.json。10,000 条历史进入中位：Chromium 基准162.6ms/候选160.3ms，WebKit 基准276.1ms/候选259.1ms；WebKit 单次最大有波动，不能据此保证真机零卡顿。计时不包含造数导入与初始水合，冷启动与真实媒体大档不在该对照结论内。

实际页面默认候选端口 3021，可用 PUBLIC_TEST_URL 改地址。CHAT_TEST_ENGINE=webkit 可运行前两个脚本的 WebKit 检查；悬浮脚本默认双内核。性能脚本使用 3022 基准和 3021 候选，要求两边运行相同生产模式；结果输出 tmp/qa。

性能对照使用 100/10,000 条合成历史、重复进入/输入和滚动，重试服务另测 30 次重试。结果是本机自动化样本，不能视为真机长期零卡顿证明。重试档案仍随历史、媒体与版本数增长。

真实模型/TTS/云服务、iPhone Safari/PWA 真机与长期使用仍需独立验收；没有操作用户资料或真实付费调用。
