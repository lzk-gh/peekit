# Release

Peekit 0.1 alpha is scoped to H5 and Weixin Mini Program support.

## Packages

Publish these packages for `0.1.0-alpha.0`:

1. `@peekit/core`
2. `@peekit/reporter`
3. `@peekit/adapter-h5`
4. `@peekit/adapter-mp-weixin`
5. `peekit`

Do not publish the planned Alipay, ByteDance, or QQ adapter packages for this alpha.
They are kept private until their real adapters and smoke checks are ready.

## Checks

Run:

```sh
pnpm clean
pnpm check
PEEKIT_WEIXIN_SMOKE=1 pnpm --filter @peekit/adapter-mp-weixin test
```

Inspect package contents:

```sh
npm pack --dry-run
```

Run the pack check inside each publishable package directory.

## Publish

Use the `next` tag for the alpha:

```sh
pnpm --filter @peekit/core publish --tag next --access public
pnpm --filter @peekit/reporter publish --tag next --access public
pnpm --filter @peekit/adapter-h5 publish --tag next --access public
pnpm --filter @peekit/adapter-mp-weixin publish --tag next --access public
pnpm --filter peekit publish --tag next --access public
```

Publish only after confirming package metadata, tarball contents, and smoke tests.
