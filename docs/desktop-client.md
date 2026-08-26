# SekerEagle desktop client

The desktop client is a macOS-first wrapper around the same UI served by SekerEagle. It requires a reachable, authenticated SekerEagle server and accelerates repeated derived-image reads with a local, rebuildable cache.

By default it connects to `http://localhost:8180`, matching the local deployment's canonical browser origin. The home-page connection pill opens an offline-capable manager with Local, LAN, and Public slots. Automatic mode keeps a healthy current connection to avoid login and cache churn; after failure it probes configured slots concurrently and chooses Local, then LAN, then Public. A manual mode never falls back silently.

Local accepts loopback only and normalizes HTTP aliases such as `127.0.0.1` and `::1` to `localhost`. Public requires HTTPS. LAN HTTP is accepted only for a literal private IP after the user enables the explicit trusted-LAN option; HTTPS remains preferred. URLs cannot contain credentials, paths, queries, or fragments, and the protected SekerChat host is rejected.

Every candidate must answer `/api/desktop/bootstrap`. The desktop records the first 256-bit deployment identity and refuses to fail over to an endpoint representing another library until the user explicitly resets that binding. Connection settings are stored atomically with owner-only permissions. `SEKEREAGLE_SERVER_URL` remains a first-run compatibility seed; saved settings take precedence.

The API must list every desktop-reachable web origin in `BROWSER_TRUSTED_ORIGINS` when it differs from `CANONICAL_ORIGIN`. For example, a LAN endpoint at `http://192.168.31.139:8180` must be trusted exactly as that origin. A probe shown as “来源未受信任” means the network path works but this server-side allowlist is incomplete.

## Cache behavior

- Default capacity is 10 GiB; settings accept 1–100 GiB.
- Only non-private WebP thumbnails, previews, posters, and tiles explicitly authorized by the API are stored.
- Cache entries are isolated by deployment and account. Signing out locks old entries; clearing the current account does not delete server media.
- Physical quota includes media allocation, SQLite/WAL files, and active partial files. Writes preserve 5% free space, bounded to a 1–5 GiB reserve so a large volume does not disable caching unnecessarily; cache eviction runs before a write is rejected.
- macOS data lives in `~/Library/Caches/SekerEagle/MediaCache/v2`, is excluded from Spotlight and Time Machine, and may be removed by the OS or user at any time.

## Failure and recovery

An unavailable server opens the packaged connection manager without depending on web assets. Resume, network recovery, and main-frame failures re-run connection resolution. Switching origins invalidates authentication snapshots and short-lived cache authorization leases before reloading the same web UI.

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

The operating system requires every dragged file to exist locally before a native drag begins. On
the first drag of an uncached selection, the desktop prepares the originals and asks the user to
drag once more. The second and later drags start synchronously without another download. This
two-step fallback avoids incomplete files and avoids starting a native drag after the mouse button
has already been released.

## Packaging

Run `npm run package:mac --workspace @sekereagle/desktop` for arm64 and x64 development DMG/ZIP artifacts. Run `npm run package:win --workspace @sekereagle/desktop` on a native Windows x64 runner for the internal unsigned NSIS artifact. The repository workflow exposes both targets manually.

Unsigned macOS builds are only for local/internal validation. Public distribution requires Developer ID signing, notarization, stapling, checksums, and a clean-machine install/login/cache/clear/upgrade/rollback rehearsal.
