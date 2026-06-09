# Capability Matrix

Capability level is a compact signal for agents:

| Level | Meaning |
| --- | --- |
| 0 | No runtime capability implemented |
| 1 | Minimal capability |
| 2 | Partial inspection capability |
| 3 | Most inspection and interaction capability |
| 4 | Full adapter capability for the current contract |

## MVP Matrix

| Capability | H5 | Weixin MP | Alipay MP | ByteDance MP | QQ MP |
| --- | --- | --- | --- | --- | --- |
| launch | yes | yes | planned | planned | planned |
| queryElement | yes | yes | planned | planned | planned |
| getMarkup | yes | yes | planned | planned | planned |
| getText | yes | yes | planned | planned | planned |
| getRect | yes | yes | planned | planned | planned |
| getStyle | yes | yes | planned | planned | planned |
| tap | yes | yes | planned | planned | planned |
| input | yes | yes | planned | planned | planned |
| scroll | yes | yes | planned | planned | planned |
| console | yes | yes | planned | planned | planned |

Weixin uses `miniprogram-automator` and requires Weixin Developer Tools automation access. Other mini program packages exist so MCP tool output can identify target intent and return explicit unsupported evidence until those adapters are implemented.

## Setup Discovery

Peekit performs safe local discovery for H5 and Weixin setup:

| Area | Default behavior |
| --- | --- |
| Browser | Checks Playwright cache, PATH, selected env vars, and common Chrome/Edge paths |
| H5 dev server | Infers loopback URLs from package scripts and probes only localhost/127.0.0.1 |
| Weixin DevTools | Checks `WECHAT_DEVTOOLS_CLI`, PATH, and common install paths |
| MCP clients | Reports known config path existence without reading file contents |
| Security | Skips full disk scans, secrets, browser profiles, public network scanning, and config writes |
