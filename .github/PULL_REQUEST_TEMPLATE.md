## Summary

Describe the user-visible outcome and the architectural boundary affected.

## Validation

- [ ] `npm run ci:check`
- [ ] `npm run oss:check`
- [ ] MLX tests, when the sidecar changed
- [ ] Fresh migration or runtime scenario, when applicable

## Safety and compatibility

- [ ] ownerId still comes only from the authenticated principal
- [ ] Cross-owner access still returns 404
- [ ] No secret, private path, user media or production data is included
- [ ] Migration, API, dependency/license and rollback impacts are documented

## Contribution certification

- [ ] Commits include a Developer Certificate of Origin `Signed-off-by` line
