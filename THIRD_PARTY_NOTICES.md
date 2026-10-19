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

## Ollama vision tagging

Optional automatic noun tagging uses the external Ollama runtime with the
`qwen3-vl:8b-instruct` model by default. The corresponding
`Qwen/Qwen3-VL-8B-Instruct` model is licensed under Apache-2.0. Neither Ollama nor
the model weights are bundled with the source release; operators download and run
them separately and remain responsible for reviewing their exact runtime versions
and licenses before redistribution.

## Image processing

The browser photo editor uses Photon (`@silvia-odwyer/photon` 0.3.3),
Copyright Silvia O'Dwyer and contributors, under Apache-2.0.
Its WebAssembly binary is bundled locally. Preserve the package's `LICENSE.md`
when redistributing it. Upstream: https://github.com/silvia-odwyer/photon.

Additional browser photo controls adapt published shader formulas from:

- glfx.js, Copyright (C) 2011 Evan Wallace, MIT. Brightness, vibrance,
  unsharp-mask/pyramid convolution, monochrome noise and vignette.
  Source: https://github.com/evanw/glfx.js. Complete notice:
  `third-party/photo-editor/glfx-LICENSE.txt`.
- GPUImage, Copyright (c) 2012 Brad Larson, Ben Cochran, Hugues Lismonde,
  Keitaroh Kobayashi, Alaric Cole, Matthew Clark, Jacob Gundersen, Chris Williams,
  BSD-3-Clause. Highlight/shadow curves, levels and white balance.
  Source: https://github.com/BradLarson/GPUImage. Complete notice:
  `third-party/photo-editor/GPUImage-LICENSE.txt`.

The CPU adaptations, signed inverse curves, luminance-only detail processing,
normalized grain coordinates and slider calibration are documented in
`docs/photo-editor.md`. These are not Adobe or Xiaomi proprietary renderers.

Photography metadata is read with exifr 7.1.3, Copyright (c) 2020 Mike Kovařík,
Mutiny.cz, MIT. Upstream: https://github.com/MikeKovarik/exifr. Complete notice:
`third-party/photo-editor/exifr-LICENSE.txt`.
Only the photography-field whitelist is used; GPS is not parsed.

The Node.js dependency tree includes Sharp distributions that bundle libvips.
Those binary distributions report a combination of Apache-2.0, LGPL-3.0-or-later
and MIT terms depending on platform. Preserve their bundled license notices when
redistributing binary images or installers.

## Complete inventory

The development-only photo workbench includes `fronalpstock.jpg`, a resized
photograph by Hannes Röst, under CC BY-SA 3.0. This photograph is separate from
the Apache-2.0 application source and is excluded from production bundles.
See `apps/web/src/components/media/photo-editor/fixtures/ATTRIBUTION.md` for
source, license, and modification details.

- Node.js: `package-lock.json`
- Python: `services/mlx-embedding/uv.lock`
- Containers: `deploy/mac/docker-compose.yml`

Run `npm run oss:check` before a release. A release process should also generate
an SBOM from the exact container images or artifacts being published.
