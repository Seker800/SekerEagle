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

## Photo metadata and maps

Photo metadata parsing uses `exifr` (MIT). Interactive maps use Leaflet
(BSD-2-Clause). Self-hosted vector maps use protomaps-leaflet 5.1.0 (BSD-3-Clause),
@protomaps/basemaps (BSD-3-Clause) and PMTiles (BSD-3-Clause). Public
Protomaps/OpenStreetMap geographic data is downloaded separately under ODbL-1.0
with visible attribution. The bundled Natural Earth overview remains a fallback.
Map viewing makes no requests to third-party tile services. Photography metadata
remains in the local application database.

## Local photo face models

The optional `services/photo-face` subprocess uses OpenCV and NumPy. Its pinned
YuNet detector weights are published by OpenCV Zoo under MIT, and SFace recognizer
weights under Apache-2.0. Weights are downloaded separately with SHA-256 verification;
the downloader retains each upstream model license beside the model file. See
`services/photo-face/README.md` for exact upstream sources and runtime setup.

## Local photo map data

The photo map bundles Natural Earth 1:50m land geometry and 1:10m populated
places. Natural Earth places this data in the public domain and allows
modification and redistribution: https://www.naturalearthdata.com/about/terms-of-use/.
The pinned source revision, source URLs, SHA-256 checksums and transformations
are recorded in `apps/web/src/components/photos/basemap/sources.json`. Normal
builds use the committed files; map viewing does not contact the data publisher.

## Camera RAW decoding

`packages/media-core/python` uses rawpy (MIT), NumPy (BSD-3-Clause) and Pillow
(MIT-CMU / Pillow license) in a separate Python environment. rawpy wraps LibRaw,
which is distributed under LGPL-2.1 or CDDL-1.0 terms. Preserve the license files
included with their wheels and any codec libraries when redistributing runtime
images. No camera firmware, camera profile packs, model weights or private RAW
photographs are bundled. Tests generate their own Bayer DNG and video patterns.
Upstream: https://github.com/letmaik/rawpy and https://www.libraw.org/ .

## Camera calibration data

`packages/media-core/python/camera-profiles.json` includes the Fujifilm X-E5
XYZ-to-camera calibration from the RawSpeed contributors' camera database.
Source: https://github.com/darktable-org/rawspeed/commit/70d3725 .
The data is distributed under Creative Commons Attribution-ShareAlike 3.0
(https://creativecommons.org/licenses/by-sa/3.0/). The data remains separately
licensed under those terms; no RawSpeed decoder code is included.

## Self-hosted vector geography

The optional regional archive is extracted from https://build.protomaps.com/20261023.pmtiles
using https://github.com/protomaps/go-pmtiles (BSD-3-Clause). Protomaps basemap
sources and attribution: https://docs.protomaps.com/basemaps/downloads .
OpenStreetMap data: https://www.openstreetmap.org/copyright ; ODbL:
https://opendatacommons.org/licenses/odbl/1-0/ . Preserve source attribution and
applicable database sharing obligations when redistributing map archives.
Geographic archives are separate from the Apache-2.0 application source.
