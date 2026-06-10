# Peekit

[English](README.md) | 简体中文

AI agent 的运行时眼睛。

Peekit 是一个面向 AI 的运行时检查 MCP server。它可以把 H5 和微信小程序目标里的页面状态、元素文本、DOM 标记或 WXML、位置尺寸、计算样式、console 输出、错误、交互、前后快照和诊断提示，变成 coding agent 可以直接使用的证据。

Peekit 不是面向人工手动操作的 CLI 工作流。npm 包只是 MCP server 的分发方式。

## 安装

把 Peekit 添加到 MCP client：

```json
{
  "mcpServers": {
    "peekit": {
      "command": "npx",
      "args": ["-y", "@peekit/cli", "mcp"]
    }
  }
}
```

然后用自然语言向你的 coding agent 提问：

```txt
检查这个按钮为什么点击后没有显示 loading 状态。
```

```txt
对比这个页面在 H5 和微信小程序里的间距、颜色和可见性。
```

```txt
修复后，用 Peekit 的前后运行时证据验证结果。
```

本机运行时路径可以使用 `~/.peekit/local-setup.json` 作为机器级配置，也可以使用 `<repo>/.peekit/local-setup.json` 作为项目级覆盖。微信小程序目标需要先在微信开发者工具的安全设置里启用服务端口，然后配置 `weixin.automation.servicePortEnabled: true`。

## 工具

Peekit 暴露这些 MCP tools：

- `peekit_inspect_environment`
- `peekit_suggest_target_config`
- `peekit_suggest_mcp_client_config`
- `peekit_validate_target`
- `peekit_explain_setup_blocker`
- `peekit_list_targets`
- `peekit_connect_target`
- `peekit_get_current_page`
- `peekit_open_page`
- `peekit_query_element`
- `peekit_query_all`
- `peekit_capture_snapshot`
- `peekit_perform_interaction`
- `peekit_compare_snapshots`
- `peekit_diagnose_issue`
- `peekit_suggest_next_probe`
- `peekit_record_case`
- `peekit_replay_case`
- `peekit_cross_target_compare`

## 当前能力

| 目标 | 状态 | 说明 |
| --- | --- | --- |
| H5 | 已实现 | 基于 Playwright，支持页面、DOM、文本、位置尺寸、计算样式、console、错误、click、tap、input、scroll、hover |
| 微信小程序 | 已实现 | 使用 `miniprogram-automator` 连接微信开发者工具，支持 route、WXML、文本、尺寸、偏移、样式、console、错误、tap、input 和 scroll |
| 支付宝小程序 | 路线图 | 不在 alpha 支持范围内；会返回明确的 unsupported evidence |
| 字节小程序 | 路线图 | 不在 alpha 支持范围内；会返回明确的 unsupported evidence |
| QQ 小程序 | 路线图 | 不在 alpha 支持范围内；会返回明确的 unsupported evidence |

不支持的能力会被明确报告，agent 可以基于能力证据推理，而不是猜测。

## 开发

```sh
pnpm install
pnpm build
pnpm test
```

包结构：

```txt
packages/
  core/
  mcp-server/
  adapter-h5/
  adapter-mp-weixin/
  adapter-mp-alipay/
  adapter-mp-bytedance/
  adapter-mp-qq/
  reporter/
docs/
examples/
```

Agent 工作流和运行时证据契约见 `docs/ai-usage.md` 和 `docs/agent-contract.md`。
真实微信开发者工具配置见 `docs/weixin-troubleshooting.md`。
Alpha 发布流程见 `docs/release.md`。
