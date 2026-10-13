# dsh-multikey

DeepSeek Harness「模型」设置页的**多 API Key 命名卡片**插件包 —— 官方三个包 `@deepseek-ai/dsh-client-ui-settings-models`、`@deepseek-ai/dsh-llm-deepseek-api-key`、`@deepseek-ai/dsh-llm-pi-ai`（v0.2.0-rc.2，MIT）的 fork，加上同一处自研特性，以**同名覆盖**（shadow package）方式安装，不需要改动 bundle 组成。

## 特性：一个服务商下多把有名字的 Key

上游的模型设置页里，一个服务商只有一个 `apiKeyEnv` 输入框（一个环境变量名）。本 fork 增加 `apiKeyProfiles`：

```jsonc
{ "ref": "DEEPSEEK_API_KEY_2", "name": "个人订阅" }
```

- `ref` 是凭证引用（环境变量名），每次请求时解析；schema 里写成 `z.string().role('credential-ref')`，所以明文 key 不会落到配置文件。
- `name` 是显示名，出现在「模型」页的卡片上。
- 一个服务商在页面上表现为一列**命名卡片**。新卡片按路由惯例派生 `<ROUTE>_API_KEY_2`、`_3` …；手动输入的 key 通过 `credentials/set` 存到该卡片自己的 `ref` 下。
- 卡片保存时把 `apiKeyEnv`（当前选中的 `ref`）与 `apiKeyProfiles` 作为一次编辑写入，并且只在用户碰过 key 设置之后才写 —— 没碰过的卡片不会生成无凭证引用的 profile，服务商原生鉴权路径因此保持原样。
- 配置写在 profile 的 patch 层，所以是持久化的：换 key 是一次选择，不是重新输入。

## 三个包各自改了什么

| 包 | 改动 |
|---|---|
| `packages/dsh-client-ui-settings-models` | UI：`ProviderEditor` 的命名 Key 卡片、`ModelsSection` 的卡片样式、`locales.ts` 文案 |
| `packages/dsh-llm-deepseek-api-key` | 配置：`apiKeyProfiles` schema（`DeepSeekApiKeyProfile`） |
| `packages/dsh-llm-pi-ai` | 配置：`apiKeyProfiles` schema（`PiAiApiKeyProfile`），以及 adapter / auth / catalog 侧按 `ref` 解析 |

## 安装

见 [INSTALL.md](./INSTALL.md)。要点：profile 的 `package.json` 用 `link:` 指向本仓库的三个包目录；包名与内置包一致，因此覆盖生效，无需在 `cordis.patch.yml` 的 `bundles` 里加行。

## src 与 lib：这是分发版

`lib/` 是宿主可直接加载的产物，`src/`、`tests/`、`README.i18n.yaml` 一并保留供审计与对照。

本仓库**不能独立重建**：`tsconfig.json` 的 `extends` 指向 DSH 源码仓库根部的 base（`tsconfig.base.json` / `tsconfig.base.client.json`），`tsdown.config.ts` 引用 `packages/tsdown.client.ts`，这些文件不在本仓库内。需要重新构建时，请在 DSH 源码仓库的对应包里执行它自己的 `pnpm run build`，再把产物拷进 `lib/`。

已构建产物里唯一的改动：`lib/client.js` 中打包器写入的 `//#region \0dsh-css:<构建根绝对路径>` 注释被剥掉了绝对路径前缀（纯注释删除，不改行为）。

## 许可与来源

上游代码 Copyright (c) DeepSeek，MIT；本仓库的 fork 差异同样以 MIT 发布，见 [LICENSE](./LICENSE)。各包的 `README.md` / `README.zh.md` / `README.i18n.yaml` 是上游文档原文，未做改写。
