package com.sekereagle.android

import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class NativeSearchPolicyTest {
    @Test
    fun combinedConditionsFollowTheSharedApiContract() {
        val parameters =
            NativeFilters(
                    setOf("b", "a"),
                    "Canon EOS R5",
                    "RF 35mm",
                    setOf("png", "jpeg"),
                    "2026-10-01",
                    "2026-10-25",
                    4,
                    "WITH",
                )
                .parameters(ZoneId.of("Asia/Shanghai"))
        assertEquals(
            mapOf(
                "manualTagIds" to "a,b",
                "tagMatch" to "ANY",
                "cameraModel" to "Canon EOS R5",
                "lensModel" to "RF 35mm",
                "formats" to "jpeg,png",
                "createdFrom" to "2026-09-30T16:00:00Z",
                "createdTo" to "2026-10-25T15:59:59.999Z",
                "rating" to "4",
                "gps" to "WITH",
            ),
            parameters,
        )
    }

    @Test
    fun calendarDateRangesRespectDstRatherThanAssumingTwentyFourHours() {
        val zone = ZoneId.of("America/New_York")
        val spring = NativeFilters(from = "2026-03-08", to = "2026-03-08").parameters(zone)
        assertEquals("2026-03-08T05:00:00Z", spring["createdFrom"])
        assertEquals("2026-03-09T03:59:59.999Z", spring["createdTo"])
        val fall = NativeFilters(from = "2026-11-01", to = "2026-11-01").parameters(zone)
        assertEquals("2026-11-01T04:00:00Z", fall["createdFrom"])
        assertEquals("2026-11-02T04:59:59.999Z", fall["createdTo"])
    }

    @Test
    fun invalidRangesRatingsAndGpsCannotProduceRequests() {
        for (filters in
            listOf(
                NativeFilters(from = "2026-02-30"),
                NativeFilters(from = "2026-10-26", to = "2026-10-25"),
                NativeFilters(rating = 0),
                NativeFilters(rating = 6),
                NativeFilters(gps = "ANY"),
                NativeFilters(tags = (0..100).map { "$it" }.toSet()),
            )) {
            assertNotNull(filters.validationError())
            assertThrows(IllegalArgumentException::class.java) { filters.parameters() }
        }
    }

    @Test
    fun removingOneTokenPreservesEveryOtherCondition() {
        val filters =
            NativeFilters(
                setOf("a", "b"),
                "Camera",
                "Lens",
                setOf("jpeg", "png"),
                "2026-01-01",
                "2026-10-25",
                3,
                "WITHOUT",
            )
        assertEquals(filters.copy(tags = setOf("b")), filters.without("tag:a"))
        assertEquals(filters.copy(formats = setOf("png")), filters.without("format:jpeg"))
        assertEquals(filters.copy(from = "", to = ""), filters.without("date"))
        assertEquals(filters, filters.without("unknown"))
    }

    @Test
    fun emptyConditionsDoNotConstrainAnOrdinaryList() {
        assertFalse(NativeFilters().active)
        assertTrue(NativeFilters().parameters().isEmpty())
        assertTrue(NativeFilters().tokens(emptyList()).isEmpty())
    }

    @Test
    fun queryValuesCannotInjectAnotherFilterOrBreakUnicodeNames() {
        val value = "相机 & gps=WITHOUT+#%"
        val query = NativeFilters(camera = value).parameters().querySuffix()
        assertEquals("&cameraModel=%E7%9B%B8%E6%9C%BA+%26+gps%3DWITHOUT%2B%23%25", query)
    }

    @Test
    fun legacyFormatAliasesUseStoredInspectionFormats() {
        assertEquals(
            listOf("jpeg", "heif", "tiff", "mp4", "mts", "mpg"),
            listOf(".JPG", "heic", "tif", "m4v", "m2ts", "mpeg").map(::canonicalFormat),
        )
    }

    @Test
    fun tagNamesAndPinyinAreNormalizedWithoutChangingTheirIdentity() {
        val tag = NativeTag("opaque", "ＡＢ 标签", normalizeTagSearch("ＡＢ 标签 biaoqian bq"))
        assertTrue(tag.matches("ab 标签"))
        assertTrue(tag.matches("B Q"))
        assertEquals("opaque", tag.id)
        assertEquals("ＡＢ 标签", tag.name)
    }

    @Test
    fun smartFolderUsesItsIdentityAndRemovingItPreservesOtherConditions() {
        val filters =
            NativeFilters(
                tags = setOf("tag"),
                formats = setOf("png"),
                smartFolderId = "folder&gps=WITH",
            )
        assertTrue(filters.active)
        assertEquals("folder&gps=WITH", filters.parameters()["smartFolderId"])
        assertTrue(filters.parameters().querySuffix().contains("smartFolderId=folder%26gps%3DWITH"))
        assertEquals(filters.copy(smartFolderId = ""), filters.without("smartFolder"))
        assertEquals(
            "智能文件夹：父 / 子",
            filters
                .tokens(emptyList(), listOf(NativeChoice("folder&gps=WITH", "父 / 子")))
                .first()
                .label,
        )
    }

    @Test
    fun folderPathsDisambiguateNamesAndTerminateForMissingOrCyclicParents() {
        val choices =
            nativeFolderChoices(
                listOf(
                    NativeFolder("a", "照片"),
                    NativeFolder("b", "素材"),
                    NativeFolder("c", "旅行", "a"),
                    NativeFolder("d", "旅行", "b"),
                    NativeFolder("e", "孤立", "missing"),
                    NativeFolder("f", "循环", "f"),
                )
            )
        assertEquals(listOf("照片", "素材", "照片 / 旅行", "素材 / 旅行", "孤立", "循环"), choices.map { it.label })
        assertEquals(6, choices.map { it.id }.toSet().size)
    }

    @Test
    fun folderOptionsMergeWithoutErasingOtherCatalogs() {
        val before = NativeOptions(tags = listOf(NativeTag("tag", "标签")), formats = listOf("png"))
        val after =
            before.merge(
                NativeOptionSection.SMART_FOLDERS,
                NativeOptions(folders = listOf(NativeChoice("folder", "收藏"))),
            )
        assertEquals(before.tags, after.tags)
        assertEquals(before.formats, after.formats)
        assertEquals("folder", after.folders.single().id)
    }
}
