# SekerEagle desktop client

## 2026-11-02 paired production release: client 0.1.9

The web/API/independent executors are now deployed, and Windows x64 portable plus macOS arm64/x64 DMGs are available at `/downloads/desktop/`. The client combines the scoped PHOTO drag bridge, complete version display, WASM compatibility, native Windows frame and both-mode cache/list reuse. Existing installed apps are not automatically replaced; quit Windows and replace the executable while preserving `SekerEagleData`.

Production acceptance also found that cached preview images could display while tainting editor canvases. Preview and full export now share the credentialed CORS image loader, using the client's existing exact-origin policy. Full CI and actual editor pixels in both modes passed locally and against production Chrome/Electron, along with real IPC/HTTP original export hashes. Physical Windows/DPI and OS drop-target acceptance remain unavailable on this Mac host. Deployment versions, rollback and validation are recorded in [the release report](main-production-release-2026-11-02-evening.md). The older candidate sections below describe their original local checkpoints.

The desktop client is a macOS and Windows wrapper around the same UI served by SekerEagle. It requires a reachable, authenticated SekerEagle server and accelerates repeated derived-image reads with a local, rebuildable cache. macOS remains the complete deployment-validation path; Windows x64 has a native internal single-file portable package and desktop-specific automated coverage.

By default it connects to `http://localhost:8180`, matching the local deployment's canonical browser origin. The home-page connection pill opens an offline-capable manager with Local, LAN, and Public slots. Automatic mode keeps a healthy current connection to avoid login and cache churn; after failure it probes configured slots concurrently and chooses Local, then LAN, then Public. A manual mode never falls back silently.

Local accepts loopback only and normalizes HTTP aliases such as `127.0.0.1` and `::1` to `localhost`. Public requires HTTPS by default. Public HTTP is accepted only after the user enables its separate cleartext-risk option, and the server must independently allow that exact origin with `SEKEREAGLE_ALLOW_INSECURE_PUBLIC_HTTP=true`. LAN HTTP is accepted only for a literal private IP after the user enables the explicit trusted-LAN option; HTTPS remains preferred. URLs cannot contain credentials, paths, queries, or fragments, and the protected SekerChat host is rejected.

Every candidate must answer `/api/desktop/bootstrap`. The desktop records the first 256-bit deployment identity and refuses to fail over to an endpoint representing another library until the user explicitly resets that binding. Connection settings are stored atomically with owner-only permissions. `SEKEREAGLE_SERVER_URL` remains a first-run compatibility seed; saved settings take precedence.

The API dynamically accepts a loopback or private-IP browser request only when its source origin exactly matches the gateway protocol, host, and port. A LAN IP therefore does not need to be copied into `BROWSER_TRUSTED_ORIGINS`; unrelated private origins and arbitrary DNS hosts remain rejected. The bundled Mac Compose configuration reserves the explicit origin list for the optional `SEKEREAGLE_PUBLIC_ORIGIN`. Public HTTP remains rejected unless the deployment explicitly enables `SEKEREAGLE_ALLOW_INSECURE_PUBLIC_HTTP`; HTTPS is the supported long-term boundary. A probe shown as “来源未受信任” now indicates a real cross-origin mismatch or an incomplete public-origin configuration.

## Photo editor security policy

The desktop CSP permits same-origin Web Workers and WebAssembly compilation (`wasm-unsafe-eval`) for the shared Photon photo renderer. JavaScript eval, remote scripts, objects, and cross-origin connections remain blocked. Updating the server cannot change an installed desktop client's CSP; desktop versions before 0.1.7 need a client update to use photo editing.

## Cache behavior

Desktop 0.1.8 adds capability-negotiated PHOTO and MATERIAL media URLs, isolated keys/namespaces, and reuse of the shared in-memory thumbnail cache. The matching web build is required; older clients retain authenticated network fallback for PHOTO. Disk hits still revalidate online. The settings panel distinguishes direct local reuse, validated reuse, network reads, shared downloads and failures for the current connection; internal SQLite lookups are no longer presented as request hit rate. Local implementation, measurement limits and validation are recorded in [client cache experience](client-cache-experience-2026-11-02.md); this statement does not declare an installed-client or server deployment.

- Default capacity is 10 GiB; settings accept 1–100 GiB.
- Only non-private WebP thumbnails, previews, posters, and tiles explicitly authorized by the API are stored.
- Cache entries are isolated by deployment and account. Signing out locks old entries; clearing the current account does not delete server media.
- Physical quota includes media allocation, SQLite/WAL files, and active partial files. Writes preserve 5% free space, bounded to a 1–5 GiB reserve so a large volume does not disable caching unnecessarily; cache eviction runs before a write is rejected.
- macOS data lives in `~/Library/Caches/SekerEagle/MediaCache/v2`, is excluded from Spotlight and Time Machine, and may be removed by the OS or user at any time.
- The Windows portable build creates `SekerEagleData` beside its executable. Browser profile, cookies, connection settings, and desktop settings live in `SekerEagleData\Profile`; derived media lives in `SekerEagleData\MediaCache\v2`. The portable default capacity is 2 GiB and remains configurable from 1–100 GiB.
- A non-portable Windows development or setup build continues to use `%LOCALAPPDATA%\SekerEagle\MediaCache\v2` and the normal Electron user profile directories.

## Failure and recovery

An unavailable server opens the packaged connection manager without depending on web assets. Resume, network recovery, and main-frame failures re-run connection resolution. Switching origins invalidates authentication snapshots and short-lived cache authorization leases before reloading the same web UI.

When no endpoint is available, the connection page shows a focused recovery message and retries saved connections every five seconds, as well as when the network comes online. It opens the library automatically after a successful retry. Address diagnostics and cache maintenance remain available in expandable settings. The shared web client distinguishes a temporary connection failure from a rejected browser session: it keeps retrying the former without showing the login form, and shows login only after the refresh session is rejected.

An unavailable or corrupt cache falls back to the normal authenticated network path. Interrupted writes and pending invalidations recover from SQLite without scanning the full media tree. The utility process is restarted at most three times per minute; repeated crashes leave caching disabled while browsing continues online.

The web shell (`index.html`) is always revalidated, while content-hashed assets are immutable for one year. This prevents an installed desktop client from remaining pinned to an old UI after the server is upgraded without sacrificing static-asset efficiency.

## Dragging originals to other apps

Dragging an unselected library thumbnail exports that asset's original file. Dragging a selected
thumbnail exports the complete selection in the library's visible order. The browser build keeps
cards non-draggable; only the desktop bridge can request a native file drag.

One native drag can contain up to 100 originals. Requests are paced below the original-download
burst limit so a selection of small files does not fail partway through with rate limiting.

The renderer sends validated asset IDs, never a URL or local path. The main process downloads each
original with the authenticated desktop session into an owner-and-deployment-isolated temporary
directory, then gives those local paths to the operating system. These exact-byte exports are not
part of the persistent derivative media cache. Partial batches are removed on failure, completed
batches expire after one hour, and stale batches are cleaned at the next desktop startup.

The operating system requires every dragged file to exist locally before a native drag begins. The
renderer therefore owns one outbound-drag session and starts preparation only after an explicit drag
gesture; hover, focus and ordinary selection never download originals. Rapid selection changes are
serialized, and the native drag starts as soon as that exact selection is ready. Releasing the gesture
aborts any active network transfer, and a prepared token that loses its gesture is discarded immediately
instead of waiting for the one-hour safety expiry. Outbound file drags are explicitly excluded from the page-level import state machine,
so returning across the app window cannot display the import overlay or upload an exported file.
Successful preparation and duplicate imports do not add persistent status rows to the library; only
actionable drag failures remain visible. Native drags use the operating system's normal-sized icon
for the prepared original instead of the app's large artwork.

The image viewer's context menu also provides **Save As…** in the desktop client. It downloads the
same authenticated, exact-byte original into the isolated temporary export area, opens the native
operating-system save dialog with the server-provided filename, and removes the temporary copy
after saving or canceling. The renderer passes only one validated asset ID; local source and
destination paths never cross the renderer bridge.

When two or more library items are selected, their context menu provides **Batch download (N)…**.
The desktop asks for one destination folder before downloading, preserves visible library order,
and writes every exact-byte original there. Existing files are never overwritten: collisions gain
a numbered suffix. A failed copy removes only files created by that batch, while canceling the
folder picker performs no download. The same 100-item bound and authenticated owner/deployment
checks used by native dragging apply to batch downloads.

## Packaging

Run `npm run package:mac --workspace @sekereagle/desktop` for arm64 and x64 development DMG/ZIP artifacts. Run `npm run package:win --workspace @sekereagle/desktop` on a native Windows x64 runner for the internal unsigned single-file portable artifact. The repository workflow exposes both platforms manually.

The portable executable requires no installation, elevation, Start Menu entry, desktop shortcut, or uninstall registration. Move the executable together with its `SekerEagleData` directory to retain login state, settings, and cache; replace only the executable when upgrading; delete both when removing the app completely. Startup fails with a clear message instead of silently writing elsewhere when the executable directory is not writable. Public Windows distribution still requires Authenticode signing and clean-machine Windows 10/11 launch, login, drag-out, upgrade, rollback, removable-drive, and deletion rehearsal. Unsigned internal builds may trigger Microsoft Defender SmartScreen.

Unsigned macOS builds are only for local/internal validation. Public distribution requires Developer ID signing, notarization, stapling, checksums, and a clean-machine install/login/cache/clear/upgrade/rollback rehearsal.

## 2026-11-02 client 0.1.8 candidate

The desktop client currently has no automatic updater. A server/web update does not replace an installed executable or its CSP. The connection controls now show the complete installed client version through a read-only bridge; older clients are explicitly identified as unable to report their version. A blocked WASM initialization reports that a client upgrade is required, while a missing device-local LUT reports the required import without silently changing the photo's edits.

0.1.8 introduces `prepareLibraryAssetDrag({assetIds, libraryMode})` for both library modes. It shares the original downloader, authentication checks, bounded concurrency and temporary-file lifetime. The old `prepareAssetDrag` remains MATERIAL-only for compatibility; a PHOTO request never falls back to that path. Renderer payloads reject owner IDs, URLs, paths and unknown modes.

Local Windows x64 portable and macOS arm64/x64 packages are prepared under `apps/desktop/release/`. For Windows, quit the client and replace only the executable, preserving the adjacent `SekerEagleData` directory. The new web UI and new desktop capability must be deployed together to enable PHOTO dragging. No installed client, production web service or automatic-update infrastructure was changed by preparing these packages. Native Windows UI/drop-target acceptance remains a separate check; the local Electron acceptance verifies real IPC, authenticated HTTP downloads, original-byte hashes and old/new CSP behavior, intercepting only the final OS drop boundary.

Windows 0.1.8 restores the native window frame and retains the hidden application menu. The former hidden-title overlay reserved space only with a body margin, which fixed-position viewers and editors ignore. Removing both that overlay and its injected page CSS lets Windows allocate the actual renderer client area for every route and dialog, without page-specific offsets or platform CSS in shared components.

The isolated Electron regression (`scripts/testing/desktop-photo-regression.mjs`) opens the real viewer and editor in both library modes, reproduces header occlusion with the old title-bar CSS, and verifies header hit-testing and full-dialog bounds after removal at 1000×700 and 1440×960 client sizes. It also verifies exact original-file hashes through the real IPC/HTTP export path, actual WASM pixels under the current CSP, and the explicit upgrade error under the previous CSP. Evidence is under `.omx/artifacts/desktop-018-acceptance/`; native Windows title-bar/DPI and physical OS drop acceptance were unavailable on this Mac host.

Final local validation on 2026-11-02: `npm run ci:check` passed (architecture gate, lint, all workspace type checks/tests/builds, contract generation, formatting and OSS checks). Desktop coverage passed its 80% thresholds: statements 88.10%, branches 80.41%, functions 90.25%, lines 92.55%. Both packaging commands succeeded; Windows x64 and both Mac ASAR main/preload files byte-match the verified build, and installer checksums are in `apps/desktop/release/SHA256SUMS-0.1.8.txt`. The temporary workbench and its two owned containers were removed. These are local candidate artifacts; no push or production deployment occurred.

## List-backed disk reuse (local candidate 0.1.9)

With the matching web build, an allowlisted authenticated list/detail is fetched once by main and passed back to the page. Exact public current renditions already on disk can then return LOCAL without individual HTTP revalidation. Proof is transient, scoped by deployment/account/mode and revoked on writes, session/navigation changes and the existing shared change checks. Other windows follow existing list snapshot freshness, not instantaneous revocation. Unknown paths, tiles, private files and old clients keep the original network route.

`SEKEREAGLE_DESKTOP_SNAPSHOT_ENTRIES` is a positive integer, default 12000, bounding main-process projection memory. LRU eviction falls back to network validation without limiting library size. `npm run test:desktop-cache:list` reproduces the isolated real-Electron comparison. See [results and limitations](client-cache-list-reuse-2026-11-02.md). This candidate has not replaced the installed application or production web build.
