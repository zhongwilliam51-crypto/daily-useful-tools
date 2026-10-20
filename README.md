# Daily Useful Tools

**每天一个简洁实用的小工具，解决生活中的一个具体问题。**

Small, practical tools for real-life problems. Open source. No sign-up.

**[打开工具集 →](https://zhongwilliam51-crypto.github.io/daily-useful-tools/)** · **[使用链接净化器 →](https://zhongwilliam51-crypto.github.io/daily-useful-tools/link-cleaner.html)**

## 工具目录 / Collection

| # | 工具 | 解决的问题 | 日期 |
| --- | --- | --- | --- |
| 001 | [链接净化器 / Link Cleaner](./link-cleaner.html) | 分享链接前批量移除常见广告追踪参数，保留功能参数与视频时间点 | 2026-10-20 |

## 001 · 链接净化器

粘贴一个或多个完整链接，点击“净化链接”，复制结果即可。每行一个，最多 200 行。

```text
https://example.com/article?id=42&utm_source=newsletter&utm_medium=email#read
↓
https://example.com/article?id=42#read
```

- 移除常见追踪参数：`utm_*`、`fbclid`、`gclid`、`dclid`、`gbraid`、`wbraid`、`msclkid`、`twclid`、`ttclid`、`igshid`、`mc_cid`、`mc_eid`、`li_fat_id`、`vero_id`、`_hsenc`、`_hsmi`。
- 保留其他参数、重复参数、原编码与顺序、`#fragment`。不会泛删 `ref`、`source` 等可能有功能作用的字段。
- 检测到常见签名、令牌、认证或有效期字段时，整条链接原样保留。此检测是启发式规则，不能覆盖所有网站。
- 不支持的协议、无效行、含用户名密码的链接会标明原因，并原样保留，避免静默丢失输入。
- 不展开短链，不访问链接目标，不会上传输入。页面没有分析脚本、广告、外部字体或第三方依赖。
- 修改输入后会立即清除旧结果，避免误复制过期结果。复制权限不可用时会选中结果，支持手动复制。

移除追踪参数可能影响少数网站的自定义功能；工具不能移除路径、片段或未知参数里的所有追踪信息，也不负责判断链接是否安全。请核对重要链接。

## 本地使用 / Use offline

下载本仓库后，双击 `index.html` 或 `link-cleaner.html`，即可直接使用；无需安装依赖。

也可以用静态服务器预览：

```sh
python3 -m http.server 8000
# Open http://localhost:8000
```

## 验证 / Tests

使用 Node.js 20 或更新版本，无需安装 npm 依赖：

```sh
node --test test-link-cleaner.mjs
```

测试直接读取工具页面的同一份核心逻辑，覆盖追踪字段、功能参数、字节保留、签名链接、错误输入、批量上限等场景。

## 每日制作原则

1. 先写清楚一个生活中的具体问题，再决定做什么。
2. 每个作品聚焦一件事，优先本地处理、零依赖、打开就能使用。
3. 发布前验证核心功能、边界输入与手机布局。
4. 更新本目录与工具集首页；记录真实完成的作品，不为提交次数制造无意义改动。
5. 重复执行不重复发布同日作品。失败时修复或明确报告原因，不把计划冒充完成。

这个仓库由作者在 Codex 协助下持续制作与维护。每日制作任务按香港时间 20:00 触发，成功完成后发布。

## License

[MIT](./LICENSE)
