package com.sekereagle.android

/** Per-library preference; server dates, including capture-time fallback, drive every page. */
enum class GallerySort(val title: String) {
    CAPTURED_AT("按拍摄时间排序"),
    ADDED_AT("按添加时间排序");

    companion object {
        fun default(mode: GalleryMode) = if (mode == GalleryMode.PHOTO) CAPTURED_AT else ADDED_AT

        internal fun restore(
            settings: BackupSettings,
            scope: String,
            mode: GalleryMode,
        ): GallerySort =
            entries.firstOrNull { it.name == settings.value(scope, key(mode), "") } ?: default(mode)

        fun key(mode: GalleryMode) = "native-sort:$mode"
    }
}
