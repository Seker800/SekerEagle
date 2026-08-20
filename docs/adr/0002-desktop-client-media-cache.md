# ADR 0002: Electron desktop client and rebuildable media cache

## Status

Accepted for the macOS-first V1. Windows x64 remains an internal package target from the same source and cache format.

## Decision

SekerEagle uses Electron to host the existing React/Vite UI. The server remains the only business and media source of truth. The desktop runtime adds a narrow custom media protocol and an independently restartable `utilityProcess` that owns a rebuildable SQLite index and sharded derived-media files.

Only server-authorized public derivatives can persist: thumbnails, previews, posters, and Deep Zoom WebP tiles. Originals, private assets, video, and audio bypass the disk cache. Cache identities include normalized server origin, a server-persisted random deployment identity, authenticated owner, media kind, and immutable media identifiers.

The first release targets macOS 13+ and stores cache data under `~/Library/Caches/SekerEagle`. It applies current-user permissions, Time Machine exclusion, and Spotlight exclusion. Windows uses `LocalAppData` and the same portable cache core.

## Alternatives considered

- PWA/Service Worker cache: rejected because browser quota and eviction are not suitable for user-configurable 10–100 GiB caches and do not provide the required filesystem accounting.
- Chromium HTTP cache alone: rejected because capacity, owner/deployment isolation, authorization leases, observability, and deterministic clearing are insufficient.
- Eagle-style full local library: rejected for V1 because it creates a second editable source of truth and changes the product from online-first acceleration to offline synchronization.
- Tauri: rejected for V1 because the existing Chromium/OpenSeadragon behavior is a primary compatibility requirement; using platform WebViews would increase rendering and media variance.

## Consequences

The desktop application is intentionally not an offline authorization system. Every hit requires a current authenticated owner snapshot, leases expire within five minutes, and resume or network reconnection forces revalidation. Cache failure immediately bypasses to the authenticated upstream. The cache can be deleted without affecting server data.

Public macOS distribution still requires external Developer ID signing, notarization, stapling, and release-channel credentials. Unsigned local artifacts are development candidates, not public releases.
