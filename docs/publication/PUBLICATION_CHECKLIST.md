# Publication Checklist

**Status: AUTHORIZED FOR v0.1.0 PUBLICATION - CI PASSED**

Pv Vimal Nair approved the MIT-licensed GitHub-only `v0.1.0` publication to
`https://github.com/pv-vimalnair/project-memory`. The exact time-bounded action
scope is recorded in `PUBLICATION_APPROVALS.json`. npm publication and a hosted
service are outside this authorization.

Public CI run [29640347646](https://github.com/pv-vimalnair/project-memory/actions/runs/29640347646)
passed the complete Windows and Ubuntu matrix for public source commit
`92969697a575ba4cfaf8580d24f71c26069efe79`.

Run the read-only prerequisite check from `plugins/project-memory/`:

```powershell
npm run publication:check
```

## Technical readiness

- [x] CI passes on Windows and Linux with read-only repository permissions and
  checkout credentials disabled. This is the final post-push release gate.
- [x] Plugin and skill validators pass from a clean Plugin copy without network
  access.
- [x] The self-contained bundles and logical manifests are reproducible.
- [x] Package, secret, fixture-sanitization, dependency-license, and dependency-
  audit checks pass in the final release run.
- [x] The reversible local install, implicit invocation, bootstrap, and
  deterministic new-task resume pilot is recorded.
- [x] Two reviewed low-reasoning runs over the same 30 supported briefs satisfy
  every acceptance threshold.

Lower-reasoning acceptance is recorded in
`LOWER_REASONING_TRIAL_EVIDENCE.json`. It contains the immutable trial records,
exact recomputed report, hashes, reviewer, model/tool identity, and redacted
evidence paths. Raw credentials, live project data, and absolute local paths are
excluded.

## Approved public identity

- [x] GitHub repository: `pv-vimalnair/project-memory`
- [x] Canonical URL: `https://github.com/pv-vimalnair/project-memory`
- [x] License: `MIT`
- [x] First public version: `0.1.0`
- [x] Public author and developer: `Pv Vimal Nair`
- [x] Public contact: `https://github.com/pv-vimalnair`
- [x] Private security route: GitHub private vulnerability reporting
- [x] Release channel: public GitHub repository and GitHub Release
- [x] README, privacy statement, contribution policy, and security policy
- [x] Authorized actions: repository push and GitHub Release creation only

## Release sequence

1. Require a clean source checkout and green local release gates.
2. Push the exact approved source to public `main`.
3. Require both Windows and Linux CI jobs to pass.
4. Record the green CI result in this checklist.
5. Tag the verified commit `v0.1.0` and create the GitHub Release.
6. Verify the public clone, marketplace registration, Plugin installation, and
   new-task pickup instructions.

The release-candidate workflow remains read-only and creates only unsigned CI
artifacts. It has no npm, marketplace-service, deployment, or production
authority.
