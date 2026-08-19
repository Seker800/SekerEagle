# Third-party notices

SekerEagle depends on third-party packages and runtime images. The lockfiles are
the authoritative, version-specific inventory. This document highlights
components whose terms materially affect redistribution; it is not a substitute
for the license files shipped by those components.

## MLX embedding component

`services/mlx-embedding` imports `mlx-embeddings==0.1.0`, which is licensed under
GPLv3. The component is consequently distributed under `GPL-3.0-only`, separately
from the Apache-2.0 code in the rest of this repository. Its complete license is
in `services/mlx-embedding/LICENSE`.

The default `Qwen/Qwen3-VL-Embedding-2B` model is downloaded at runtime from a
pinned revision and is licensed under Apache-2.0. Model weights are not stored in
this repository. Operators remain responsible for reviewing the model card and
license before redistributing downloaded weights.

## Image processing

The Node.js dependency tree includes Sharp distributions that bundle libvips.
Those binary distributions report a combination of Apache-2.0, LGPL-3.0-or-later
and MIT terms depending on platform. Preserve their bundled license notices when
redistributing binary images or installers.

## Complete inventory

- Node.js: `package-lock.json`
- Python: `services/mlx-embedding/uv.lock`
- Containers: `deploy/mac/docker-compose.yml`

Run `npm run oss:check` before a release. A release process should also generate
an SBOM from the exact container images or artifacts being published.
