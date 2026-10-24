package com.sekereagle.android

/** One row description drives both date headers and viewport restoration. */
internal class NativeGridLayout(items: List<NativeAsset>, photo: Boolean, leadingItems: Int) {
    val dayStarts = mutableSetOf<String>()
    private val indices = mutableMapOf<String, Int>()

    init {
        var index = leadingItems
        items.forEachIndexed { position, asset ->
            if (photo && (position == 0 || asset.groupDate != items[position - 1].groupDate)) {
                dayStarts.add(asset.id)
                index++
            }
            indices[asset.id] = index++
        }
    }

    fun indexOf(assetId: String): Int? = indices[assetId]
}
