# 安装（分发版）

本仓库以**同名覆盖**的方式生效：包名与 DSH 内置包一致，profile 里的 `link:` 依赖会让 loader 解析到本地副本，从而覆盖 app.asar 内置的那份。

## 1. 挂上三个包

编辑 `~/.dsh/profiles/<profile>/package.json`，在 `dependencies` 里加入三行（路径换成你 clone 的位置）：

```json
{
  "dependencies": {
    "@deepseek-ai/dsh-client-ui-settings-models": "link:/absolute/path/to/dsh-multikey/packages/dsh-client-ui-settings-models",
    "@deepseek-ai/dsh-llm-deepseek-api-key": "link:/absolute/path/to/dsh-multikey/packages/dsh-llm-deepseek-api-key",
    "@deepseek-ai/dsh-llm-pi-ai": "link:/absolute/path/to/dsh-multikey/packages/dsh-llm-pi-ai"
  }
}
```

## 2. 安装并重启

```sh
cd ~/.dsh/profiles/<profile>
pnpm install
```

然后**完全退出** DeepSeek Harness 再打开（宿主半需要进程重启；浏览器半会热加载，但为了一次到位请重启）。

## 3. 验证

打开 设置 → 模型，任选一个 DeepSeek / pi-ai 服务商：主字段应是一列可命名的 API Key 卡片，而不是单个环境变量名输入框。新增一张卡片并保存，profile 的 patch 层里应出现：

```yaml
config:
  apiKeyEnv: DEEPSEEK_API_KEY_2
  apiKeyProfiles:
    - ref: DEEPSEEK_API_KEY_2
      name: 个人订阅
```

## 卸载

删掉 `dependencies` 里那三行，再 `pnpm install` 并完全重启 —— 内置版本随即恢复。

## 注意

- 三个包要一起装。只装 UI 包时，`apiKeyProfiles` 会被 provider 侧的 schema 拒写；只装 provider 包时，设置页仍是旧的单 key 输入框。
- 升级 DSH 后如果版本号不再匹配，需要按新版本重新构建这份 `lib/`（见 README「src 与 lib」）。
