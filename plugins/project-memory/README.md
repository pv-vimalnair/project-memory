# Project Memory Plugin

Do you switch between AI agents and have to explain the project all over again?
Project Memory keeps decisions, progress, completed work, removals, and next
steps in the repository so the next agent knows where to continue.

People speak to the agent normally. They do not select profiles, choose document
folders, or edit generated memory manually.

## Install the Codex Plugin

The public repository contains the verified prebuilt offline bundles:

```powershell
git clone https://github.com/pv-vimalnair/project-memory.git
cd project-memory
codex plugin marketplace add "<absolute-path-to-project-memory>"
codex plugin add project-memory@project-memory
```

Start a new Codex task after installation. The Plugin invokes its local MCP
tools automatically when a repository task begins.

Requirements: Git, Codex Plugin support, and Node.js 24. No npm installation is
required for Plugin users, and no dependencies are installed into target
projects.

## Behavior

- New projects receive one compact bootstrap proposal and one confirmation.
- Initialized projects resume from accepted repository context.
- Existing handoffs, PRDs, changelogs, decisions, and task notes are reviewed through one guided history proposal; the agent reads the named sources and Pitaji confirms once.
- Canonical changes remain bound to an approved plan and the current Git head.
- Repository and Git history are authoritative; cloud mirrors are optional.
- The runtime is offline and has no telemetry or hosted service.

See the repository [README](../../README.md), [privacy statement](../../PRIVACY.md),
and [security policy](../../SECURITY.md).

## Development package

The package is also the deterministic engine and CLI development surface.
Consumers import from the package root only; deep source paths are internal.

Release-candidate automation produces an unsigned npm tarball, SHA-256 file,
catalog and schema bundles, deterministic benchmark report, test evidence, and
a canonical logical manifest. It does not publish to npm.

Use Node.js 24 and verify a downloaded CLI tarball before installation:

```powershell
Get-FileHash .\pitaji-project-memory-0.1.1.tgz -Algorithm SHA256
Get-Content .\pitaji-project-memory-0.1.1.tgz.sha256
npm install --global .\pitaji-project-memory-0.1.1.tgz --ignore-scripts
project-memory --help
```

On Linux, use `sha256sum -c pitaji-project-memory-0.1.1.tgz.sha256` before the
same global install command.

Run `npm run generated:verify`, `npm run plugin:verify`, and
`npm run package:verify` from this directory for the complete local release
verification. The two recorded lower-reasoning trials and acceptance report are
stored under `docs/publication/` and `benchmarks/lower-reasoning-trials/`.
