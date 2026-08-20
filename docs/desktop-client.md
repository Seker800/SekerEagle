# SekerEagle desktop client

The desktop client is a macOS-first wrapper around the same UI served by SekerEagle. It requires a reachable, authenticated SekerEagle server and accelerates repeated derived-image reads with a local, rebuildable cache.

## Cache behavior

- Default capacity is 10 GiB; settings accept 1–100 GiB.
- Only non-private WebP thumbnails, previews, posters, and tiles explicitly authorized by the API are stored.
- Cache entries are isolated by deployment and account. Signing out locks old entries; clearing the current account does not delete server media.
- Physical quota includes media allocation, SQLite/WAL files, and active partial files. Writes stop below the larger of 5 GiB or 5% free disk space, after first attempting cache eviction.
- macOS data lives in `~/Library/Caches/SekerEagle/MediaCache/v2`, is excluded from Spotlight and Time Machine, and may be removed by the OS or user at any time.

## Failure and recovery

An unavailable or corrupt cache falls back to the normal authenticated network path. Interrupted writes and pending invalidations recover from SQLite without scanning the full media tree. The utility process is restarted at most three times per minute; repeated crashes leave caching disabled while browsing continues online.

## Packaging

Run `npm run package:mac --workspace @sekereagle/desktop` for arm64 and x64 development DMG/ZIP artifacts. Run `npm run package:win --workspace @sekereagle/desktop` on a native Windows x64 runner for the internal unsigned NSIS artifact. The repository workflow exposes both targets manually.

Unsigned macOS builds are only for local/internal validation. Public distribution requires Developer ID signing, notarization, stapling, checksums, and a clean-machine install/login/cache/clear/upgrade/rollback rehearsal.
