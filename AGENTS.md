# AI Project Rules

## Git Commit Rules

Prefer Conventional Commits style for commit messages:

```text
<type>(<scope>): <subject>
<type>: <subject>
```

The `subject` must be a single concise English sentence.

Examples:

```text
feat(mcp): add snapshot comparison tool
fix(adapter-h5): normalize console error output
docs: update MCP installation guide
```

## Git Branch Rules

Do not develop directly on `main`.

Use `main` as the stable branch for reviewed, buildable, and releasable code. Create short-lived topic branches from the latest `origin/main` for all work.

Recommended branch names:

```text
feat/<short-topic>
fix/<short-topic>
docs/<short-topic>
test/<short-topic>
chore/<short-topic>
release/<version>
```

Examples:

```text
feat/h5-snapshot-screenshot
feat/weixin-event-probes
fix/mcp-tool-schema
docs/git-workflow
release/0.1.0
```

Before starting work:

```sh
git fetch origin
git switch main
git pull --ff-only
git switch -c feat/<short-topic>
```

After finishing work, run validation before pushing:

```sh
pnpm build
pnpm test
git push -u origin <branch-name>
```
