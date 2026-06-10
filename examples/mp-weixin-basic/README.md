# Weixin Mini Program Basic

This directory is a target-detection fixture for `peekit_inspect_environment` and a minimal project path for the Weixin adapter.

Runtime inspection requires Weixin Developer Tools with automation support. Connect with a target config similar to:

```json
{
  "type": "mp-weixin",
  "projectPath": "path/to/your/mini-program",
  "cliPath": "path/to/wechatdevtools/cli"
}
```

The adapter test suite uses a fake automator by default. A real Weixin smoke test is available
only when explicitly enabled:

```sh
PEEKIT_WEIXIN_SMOKE=1 pnpm --filter @peekit/adapter-mp-weixin test
```

Before enabling it, create the local-only `.peekit/local-setup.json` file and set
`weixin.automation.servicePortEnabled` to `true` after enabling Weixin Developer Tools
Settings > Security > Service Port. The smoke test does not run by default.
