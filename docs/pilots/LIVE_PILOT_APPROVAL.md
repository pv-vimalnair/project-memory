# Live pilot approval record

Status: **TEMPLATE — NOT AN APPROVAL**

Copy this template to a new append-only approval record only after the scratch pilot and release gates pass. Placeholders invalidate approval. A chat message, prior approval, broad project permission, or approval for another target cannot fill a field implicitly.

One approval authorizes exactly one pilot and one target. LifeOf approval does not authorize Dino Escape. Dino Escape approval does not authorize LifeOf. It also does not authorize deployment, publication, production changes, external communication, or deletion.

## Exact binding

```yaml
schema_version: "1.0.0"
approval_id: "<APPROVAL-ULID>"
pilot_id: "<lifeof|dino-escape>"
repository: "<exact absolute path and remote identity>"
expected_head: "<40-character Git commit>"
branch: "<exact branch or target ref>"
isolated_worktree_path: "<exact empty scratch path outside live checkout>"
scope:
  - "<one bounded pilot outcome>"
starts_at: "<ISO-8601 timestamp with offset>"
expires_at: "<ISO-8601 timestamp with offset>"
allowed_writes:
  - "<exact repository-relative file or directory pattern>"
import_owner: "<named human who accepts or rejects every import mapping>"
commit_permission: "<none|one coordinator-owned pilot commit>"
rollback_permission: "<none|one revert commit for the exact pilot commit>"
approver: "Pv Vimal Nair (Pitaji)"
approved_at: "<ISO-8601 timestamp with offset>"
approval_source: "<exact user instruction or signed record reference>"
```

Every placeholder must be replaced with an exact value. `starts_at` must precede `expires_at`; approval is invalid outside that window or after target, HEAD, branch, worktree, scope, owner, or allowed writes drift.

## Mandatory readiness evidence

- [ ] The package tarball SHA-256 and unsigned logical manifest are verified.
- [ ] The target-specific preflight is read-only and passed against `expected_head`.
- [ ] The approved dirty-state baseline and all applicable instruction files are recorded.
- [ ] Backup and rollback evidence includes the pre-pilot HEAD, verified bundle hash, owner, and permitted method.
- [ ] Secret handling excludes credentials, personal data, private source bytes, and sensitive artifacts from prompts and records.
- [ ] The dry run records the plan hash, expected HEAD, source hashes, canonical diff, write allowlist, authority, approvals, and not-run checks.
- [ ] Acceptance checks are objective, target-visible, and assigned to a named reviewer.
- [ ] Explicit approval is present for any commit and for the exact rollback authority; silence means `none`.

## Non-transferability and automatic invalidation

This record becomes invalid immediately when:

- the repository, remote, HEAD, branch, worktree, scope, time window, allowed-write set, import owner, or permission changes;
- discovery reveals a secret, personal-data, licensing, ownership, nested-repository, or access condition not covered here;
- a command proposes an external action, history rewrite, direct canonical writer, lease argument, extra root, or file outside `allowed_writes`;
- the dry-run plan is not recomputed immediately before the authorized coordinator operation;
- another pilot, target, branch, worktree, follow-on fix, cleanup, or release action is attempted.

Invalidation means stop and preserve evidence. It does not imply cleanup or rollback permission.

## Final authorization statement

The approval is valid only when Pitaji explicitly states that this fully completed record is approved for the named pilot, exact target, window, writes, import owner, commit permission, and rollback permission. The executor must quote that approval source in the pilot receipt. No agent may self-approve, infer approval, reuse it, broaden it, or replace missing values.
