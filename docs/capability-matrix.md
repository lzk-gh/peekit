# Capability Matrix

Capability level is a compact signal for agents:

| Level | Meaning |
| --- | --- |
| 0 | No runtime capability implemented |
| 1 | Minimal capability |
| 2 | Partial inspection capability |
| 3 | Most inspection and interaction capability |
| 4 | Full adapter capability for the current contract |

## Alpha Matrix

| Capability | H5 | Weixin MP | Alipay MP | ByteDance MP | QQ MP |
| --- | --- | --- | --- | --- | --- |
| launch | yes | yes | roadmap | roadmap | roadmap |
| queryElement | yes | yes | roadmap | roadmap | roadmap |
| getMarkup | yes | yes | roadmap | roadmap | roadmap |
| getText | yes | yes | roadmap | roadmap | roadmap |
| getRect | yes | yes | roadmap | roadmap | roadmap |
| getStyle | yes | yes | roadmap | roadmap | roadmap |
| tap | yes | yes | roadmap | roadmap | roadmap |
| input | yes | yes | roadmap | roadmap | roadmap |
| scroll | yes | yes | roadmap | roadmap | roadmap |
| console | yes | yes | roadmap | roadmap | roadmap |

Weixin uses `miniprogram-automator` and requires Weixin Developer Tools automation access. The `0.1.0-alpha.0` release supports H5 and Weixin Mini Program only. Other mini program targets are roadmap items; MCP output can identify target intent and return explicit unsupported evidence until those adapters are implemented.

## Setup Discovery

Peekit performs safe local discovery for H5 and Weixin setup:

| Area | Default behavior |
| --- | --- |
| Local setup manifest | Reads `~/.peekit/local-setup.json` and project `.peekit/local-setup.json` first |
| Browser | Checks manifest browserPath, Playwright cache, PATH, and selected env vars |
| H5 dev server | Infers loopback URLs from package scripts and probes only localhost/127.0.0.1 |
| Weixin DevTools | Checks manifest cliPath, `WECHAT_DEVTOOLS_CLI`, and PATH |
| MCP clients | Uses manifest paths and generates snippets without reading or writing config files |
| Security | Skips full disk scans, secrets, browser profiles, public network scanning, and config writes |
