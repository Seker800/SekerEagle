package com.sekereagle.android

import android.content.Context
import kotlin.math.*
import org.json.JSONObject

/** Same bundled gazetteer as the web map. Coordinates never leave the device. */
internal object NativeCity {
    private data class City(val name: String, val latitude: Double, val longitude: Double)

    private var cities: List<City> = emptyList()

    @Synchronized
    fun initialize(context: Context) {
        if (cities.isNotEmpty()) return
        val rows =
            JSONObject(context.assets.open("cities.json").bufferedReader().use { it.readText() })
                .getJSONArray("cities")
        cities =
            (0 until rows.length()).map {
                rows.getJSONObject(it).let { row ->
                    City(
                        row.optString("nameZh").ifEmpty { row.getString("name") },
                        row.getDouble("latitude"),
                        row.getDouble("longitude"),
                    )
                }
            }
    }

    fun label(asset: JSONObject): String? {
        asset.optJSONObject("photoLocation")?.let { location ->
            if (location.optInt("assetRevision") == asset.optInt("mediaRevision"))
                location
                    .optString("name")
                    .takeUnless { it.isBlank() || it == "null" }
                    ?.let {
                        return it
                    }
        }
        val metadata = asset.optJSONObject("photoMetadata") ?: return null
        val lat = metadata.optDouble("latitude", Double.NaN)
        val lon = metadata.optDouble("longitude", Double.NaN)
        if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0)
            return null
        var distance = 60.0
        var result: String? = null
        for (city in cities) {
            val dy = Math.toRadians(city.latitude - lat)
            val dx = Math.toRadians(city.longitude - lon)
            val a =
                sin(dy / 2).pow(2) +
                    cos(Math.toRadians(lat)) *
                        cos(Math.toRadians(city.latitude)) *
                        sin(dx / 2).pow(2)
            val km = 12742 * asin(sqrt(a.coerceIn(0.0, 1.0)))
            if (km < distance) {
                distance = km
                result = city.name
            }
        }
        return result?.let { "$it 附近" }
    }
}
