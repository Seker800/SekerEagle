# Open-source release checklist

This checklist is the release gate for changing the repository to public or
publishing a tagged artifact.

## Rights and licensing

- [ ] The release owner has confirmed the right to publish all code derived from
      SekerChat and every bundled logo or asset.
- [ ] Root Apache-2.0 and MLX sidecar GPL-3.0-only boundaries still match the
      implementation and dependency graph.
- [ ] `THIRD_PARTY_NOTICES.md`, Node/Python lockfiles and the generated artifact
      SBOM describe the exact shipped versions.
- [ ] Model weights are not committed or bundled without a separate license review.
- [ ] Public pages state that SekerEagle is not an official Eagle product.

## Secrets and private data

- [ ] Gitleaks or TruffleHog has scanned all branches, tags and historical commits.
- [ ] Every real credential ever placed in Git, logs, screenshots or artifacts has
      been revoked or rotated before publication.
- [ ] No `.env`, bootstrap credential, database dump, media file, benchmark sample,
      private hostname or user path is tracked.
- [ ] GitHub secret scanning, push protection and private vulnerability reporting
      are enabled.

## Reproducibility and security

- [ ] `npm ci`, `npm run db:generate`, `npm run ci:check` and `npm run mlx:test` pass.
- [ ] Compose configuration and all production Docker builds pass from a clean clone.
- [ ] A fresh empty instance can create an admin, log in, upload an asset and restart
      without data loss.
- [ ] Dependabot, CodeQL and dependency review are enabled and have no unresolved
      high or critical findings.
- [ ] A database/object-storage backup and restore rehearsal has passed.

## Publication

- [ ] README support matrix, limitations, privacy statement and operations guide are current.
- [ ] The worktree is clean and the release commit contains no unrelated local work.
- [ ] `CHANGELOG.md` has a dated release section and package versions agree.
- [ ] The tag and published artifacts are signed; container images use immutable digests.
- [ ] The release announcement includes known limitations and upgrade/rollback steps.
