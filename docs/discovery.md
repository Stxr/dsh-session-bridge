# DSH 插件发现规则

核实日期：2026-11-07；官方规则以已验证的 DSH 0.2.2-rc.1 对应源代码快照为准。

## GitHub 话题

公开仓库添加 **`dsh-plugin`** topic，可被 GitHub 的 `topic:dsh-plugin` 搜索找到。社区 [AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace#readme) 明确使用 GitHub Search API 实时同步这一话题。`deepseek-harness`、`cordis`、`session-navigation` 等话题用于补充搜索，不能代替 `dsh-plugin`。

该社区市场会探测根目录 `package.json` 的 `dsh.bundle` / `dsh.client`，优先使用已发布 npm 包，未发布到 npm 时可使用 GitHub spec，因此本仓库把可安装包清单放在根目录，提交由 TypeScript 编译的 `lib/`、类型声明和展示资源，Git 安装无需执行构建或安装脚本。它的文档也说明部分安装工具默认使用 web profile；本插件必须安装到 **desktop profile**，建议使用 README 中的 AI 安装提示词。

GitHub 的搜索索引和第三方市场缓存可能延迟更新，添加 topic 不等于已被所有市场收录。

## 官方“发现”页

[官方插件索引指南](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/user/guide/plugin-market.zh.md) 明确：**DSH 不内置任何索引源**。用户启用实验性的“自定义插件索引”后，手动在“发现”页添加索引 URL；topic 本身不会自动进入这个页面。

本仓库提供的索引：

```text
https://raw.githubusercontent.com/Stxr/dsh-session-bridge/main/index.json
```

索引采用官方 format 1，声明中英文展示信息、图标、包名、版本、兼容性及完整40位 Git 提交 SHA。`source.type` 为 `git`，安装固定提交，无需 npm 发布。图标相对于索引 URL 解析。

读索引只负责发现；安装仍通过 DSH 常规插件管理器并进行兼容性检查。索引源由用户自行添加，不由插件或安装提示词静默修改。

## 元信息与更新

包清单提供 `repository`、`homepage`、`bugs`、`author`、`keywords`、`dsh.bundle.patch`、`dsh.client`、精确 `engines.dsh`，导出中英文 locale 和图标。

官方参考生成器会跳过 Git 仓库中 `package.json` 设置了 `"private": true` 的包，本包不设置该标记。关键词 `dsh-plugin` 有助于生成器和搜索读取元信息，但不能替代 GitHub topic 或用户配置的索引。

新版本应先更新包版本、提交源代码并打 `vX.Y.Z` 标签，再将索引的新版本指向该提交，同时更新 `publishTimestamp`、`engines.dsh` 和 README 推荐版本。版本、包名和兼容范围必须与对应提交中的包清单一致。索引只是市场声明，不是 DSH 官方认证。

格式及校验器来源：

- [索引格式说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md)
- [官方索引校验器](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/util/plugin-market-index)
- [社区话题市场](https://github.com/AwesomeHou/dsh-plugin-marketplace#readme)
