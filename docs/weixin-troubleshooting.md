# Weixin Troubleshooting

This guide is for agents and developers validating the real Weixin Developer Tools adapter.

## Local Setup Manifest

Use a local-only setup manifest. Do not commit it.

```json
{
  "weixin": {
    "cliPath": "path/to/weixin-devtools/cli.bat",
    "projectPath": "path/to/your/mini-program",
    "automation": {
      "servicePortEnabled": true,
      "port": 9420
    }
  }
}
```

Recommended locations:

- Machine paths: `~/.peekit/local-setup.json`
- Project overrides: `<repo>/.peekit/local-setup.json`

Peekit reads these files as local configuration only. Agents should not paste real user paths into issues, docs, commits, or final public reports.

## Security Settings

Weixin Developer Tools must allow automation before Peekit tries to connect:

1. Open Weixin Developer Tools.
2. Open Settings.
3. Open Security Settings.
4. Enable the service port and automation-related switches.
5. Set `weixin.automation.servicePortEnabled` to `true` in the local setup manifest.

If this is not confirmed, Peekit should return a `permission_required` blocker instead of repeatedly trying to connect.

## Windows CLI Notes

On Windows, Weixin Developer Tools commonly exposes `cli.bat`. Some Node.js versions cannot launch `.bat` files directly with `spawn`. Peekit works around this by preferring the `node.exe` and `cli.js` files next to `cli.bat` when available.

If launch fails, verify the CLI path with:

```sh
path/to/weixin-devtools/cli.bat --help
```

## Automation Port

Weixin Developer Tools has more than one local port concept:

- `--port` controls the IDE HTTP server port.
- `--auto-port` controls the automation WebSocket port used by `miniprogram-automator`.

Peekit uses the automation port. If the IDE says it is already running on another port, quit Developer Tools and let the smoke test launch it again with the configured automation port.

Useful checks:

```sh
path/to/weixin-devtools/cli.bat quit
PEEKIT_WEIXIN_SMOKE=1 pnpm --filter @peekit/adapter-mp-weixin test
```

## Real Smoke Test

The real smoke test is opt-in and should not run in normal CI:

```sh
PEEKIT_WEIXIN_SMOKE=1 pnpm --filter @peekit/adapter-mp-weixin test
```

It requires:

- Weixin Developer Tools installed.
- Security service port enabled.
- `weixin.cliPath` set in the local setup manifest.
- `weixin.projectPath` set to a runnable mini program project.
- `weixin.automation.servicePortEnabled` set to `true`.

Default tests use fake adapter fixtures and do not launch Weixin Developer Tools.

## Common Failures

`permission_required`

Enable Weixin Developer Tools Settings > Security > Service Port, then set `weixin.automation.servicePortEnabled` to `true`.

`Failed to launch Weixin Developer Tools`

Check `weixin.cliPath`. On Windows, point to `cli.bat`; Peekit will handle the `node.exe cli.js` launch path internally when available.

`Failed connecting to ws://127.0.0.1:<port>`

The automation WebSocket is not open on the configured port. Quit Developer Tools, confirm the configured `automation.port`, then run the smoke test again.

`Tool.getInfo` works but page inspection hangs

The project window may not have loaded a runnable mini program page. Confirm the project has `app.json`, `app.js`, and the page `.js/.json/.wxml/.wxss` files.

UTF-8 BOM parse errors

Peekit accepts UTF-8 BOM in local setup manifests. If a separate tool fails to parse the file, rewrite the manifest as normal UTF-8 JSON.
