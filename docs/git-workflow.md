# Git Workflow

Peekit uses a lightweight trunk-based workflow.

## Stable Branch

`main` is the stable branch. It should contain reviewed, buildable, and releasable code only.

Avoid direct development on `main`. Use topic branches for every change.

## Topic Branches

Create topic branches from the latest `origin/main`:

```sh
git fetch origin
git switch main
git pull --ff-only
git switch -c feat/<short-topic>
```

Use these prefixes:

| Prefix | Use |
| --- | --- |
| `feat/` | New product or package capability |
| `fix/` | Bug fixes and behavior corrections |
| `docs/` | Documentation-only changes |
| `test/` | Test coverage and test fixtures |
| `chore/` | Tooling, config, dependency, or maintenance work |
| `release/` | Release preparation |

## Suggested Next Branches

| Branch | Purpose |
| --- | --- |
| `feat/mcp-contract-tests` | Add MCP tool contract tests for input and output stability |
| `feat/h5-integration-tests` | Add Playwright integration tests for DOM, style, console, click, input, and scroll |
| `feat/weixin-integration-fixture` | Validate Weixin adapter behavior against a runnable fixture |
| `feat/case-persistence` | Persist recorded cases instead of keeping them in memory only |
| `feat/cross-target-compare` | Improve H5 and mini program comparison output |
| `docs/adapter-roadmap` | Document adapter priorities and unsupported capability handling |
| `release/0.1.0` | Prepare the first npm and GitHub release |

## Merge Expectations

Before a branch is merged:

```sh
pnpm build
pnpm test
```

Commit messages should follow the rules in `AGENTS.md`.

After a branch is merged, delete the topic branch locally and remotely:

```sh
git branch -d <branch-name>
git push origin --delete <branch-name>
```

## Release Branches

Use `release/<version>` only when preparing a release. Release branches should contain version bumps, changelog updates, package validation, and final release fixes.

Tag releases from `main` after the release branch is merged:

```sh
git tag v0.1.0
git push origin v0.1.0
```
