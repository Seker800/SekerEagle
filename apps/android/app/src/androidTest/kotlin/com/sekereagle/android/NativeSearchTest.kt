package com.sekereagle.android

import android.app.Application
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Deterministic, loopback-only search contract and large-library UI regressions. */
class NativeSearchTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app
        get() = instrumentation.targetContext.applicationContext as Application

    private fun main(block: () -> Unit) = instrumentation.runOnMainSync(block)

    private fun await(condition: () -> Boolean) = compose.waitUntil(20_000, condition)

    private class Server(val tagCount: Int = 3, val assetCount: Int = 1) : AutoCloseable {
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val paths = CopyOnWriteArrayList<String>()
        @Volatile var mediaStatus = 200
        @Volatile var photoStatus = 200
        @Volatile var assetStatus = 200
        @Volatile var assetDelay = 0L
        @Volatile var tagDelay = 0L
        private val workers = CopyOnWriteArrayList<Thread>()
        private val tags =
            (0 until tagCount).joinToString(",", "[", "]") {
                JSONObject()
                    .put("id", "tag$it")
                    .put("name", "标签$it")
                    .put("pinyin", "biaoqian$it")
                    .put("pinyinInitials", "bq$it")
                    .put("legacyMetadata", "x".repeat(if (tagCount > 1000) 350 else 0))
                    .toString()
            }
        private val thread =
            Thread {
                    try {
                        while (!socket.isClosed) {
                            val accepted = socket.accept()
                            workers +=
                                Thread {
                                        accepted.use { client ->
                                            client.soTimeout = 5000
                                            val reader = client.getInputStream().bufferedReader()
                                            val path =
                                                (reader.readLine() ?: return@use).split(" ")[1]
                                            paths.add(path)
                                            while (!reader.readLine().isNullOrEmpty()) {}
                                            if (path.contains("manual-tags")) Thread.sleep(tagDelay)
                                            if (path.contains("/assets?")) Thread.sleep(assetDelay)
                                            val status =
                                                when {
                                                    path.contains("/assets?") -> assetStatus
                                                    path.endsWith("media-capabilities") ->
                                                        mediaStatus
                                                    path.endsWith("photography/facets") ->
                                                        photoStatus
                                                    else -> 200
                                                }
                                            val body =
                                                when {
                                                    path == "/api/auth/me" ->
                                                        """{"user":{"id":"owner","email":"search@example.invalid"},"desktopCache":{"deploymentId":"search"}}"""
                                                    path.contains("manual-tags") -> tags
                                                    path.endsWith("media-capabilities") ->
                                                        """{"images":{"formats":["jpeg","png"]},"videos":{"formats":["mp4"]}}"""
                                                    path.endsWith("photography/facets") ->
                                                        """{"cameras":["Camera A"],"lenses":["Lens B"]}"""
                                                    path.contains("/timeline") ->
                                                        """{"days":[],"total":1}"""
                                                    path.contains("/assets?") -> {
                                                        val start =
                                                            if (path.contains("cursor=")) 60 else 0
                                                        val rows =
                                                            (start until
                                                                    minOf(start + 60, assetCount))
                                                                .joinToString(",") { i ->
                                                                    val id =
                                                                        if (assetCount == 1) "asset"
                                                                        else "asset$i"
                                                                    """{"id":"$id","displayName":"photo$i","mediaRevision":1,"rowVersion":1,"renditions":[]}"""
                                                                }
                                                        """{"items":[$rows],"nextCursor":${if (assetCount > start + 60) "\"60\"" else "null"}}"""
                                                    }
                                                    else -> "{}"
                                                }
                                            val bytes = body.toByteArray()
                                            runCatching {
                                                client
                                                    .getOutputStream()
                                                    .write(
                                                        "HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                                                            .toByteArray()
                                                    )
                                                client.getOutputStream().write(bytes)
                                            }
                                        }
                                    }
                                    .apply { start() }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            thread.join(6000)
            workers.forEach { it.join(6000) }
        }
    }

    private fun model(server: Server): NativeGalleryViewModel {
        BackupSettings(app).apply {
            origin(server.origin)
            saveToken(
                "native-session:${server.origin}",
                JSONObject().put("sekereagle_access", "fixture").toString(),
            )
        }
        lateinit var model: NativeGalleryViewModel
        main { model = NativeGalleryViewModel(app) }
        await { model.state.value.identity != null && !model.state.value.loading }
        return model
    }

    @Test
    fun tagPickerDoesNotDependOnFormatsOrPhotographyServices() {
        Server().use { server ->
            server.mediaStatus = 503
            server.photoStatus = 503
            val model = model(server)
            main { model.openFilters("标签") }
            await { !model.state.value.optionsLoading }
            assertEquals(3, model.state.value.options.tags.size)
            assertNull(model.state.value.optionsError)
            assertFalse(
                server.paths.any {
                    it.endsWith("media-capabilities") || it.endsWith("photography/facets")
                }
            )
            main { model.logout() }
        }
    }

    @Test
    fun largeLegacyTagCatalogSupportsSearchAndBoundedComposition() {
        Server(9000).use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main {
                model.openSearch()
                model.openFilters("标签")
            }
            await { !model.state.value.optionsLoading }
            assertEquals(
                "A legacy catalog above two MiB must remain usable",
                9000,
                model.state.value.options.tags.size,
            )
            assertTrue(
                compose.onAllNodes(hasTestTagPrefix("tag-choice:")).fetchSemanticsNodes().size < 30
            )
            compose.onNodeWithTag("tag-search").performTextInput("bq8999")
            await { compose.onAllNodesWithText("标签8999").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("标签8999").performClick()
            compose.waitForIdle()
            captureNativeEvidence("native-search-tags.png")
            compose.onNodeWithTag("filter-submit").assertIsDisplayed().performClick()
            compose.onNodeWithTag("native-search").assertExists()
            compose.onNodeWithTag("search-submit").assertIsDisplayed().performClick()
            await { !model.state.value.loading }
            assertEquals(setOf("tag8999"), model.state.value.filters.tags)
            main { model.logout() }
        }
    }

    @Test
    fun removingDraftConditionDoesNotPublishOrChangeCommittedSearch() {
        Server().use { server ->
            val model = model(server)
            main { model.search("old", NativeFilters(tags = setOf("tag0"))) }
            await { !model.state.value.loading }
            val requests = server.paths.count { it.contains("/assets?") }
            main {
                model.openSearch()
                model.updateSearchDraft("new")
                model.removeFilter("tag:tag0")
            }
            assertEquals(
                "The visible committed result must remain unchanged until submission",
                setOf("tag0"),
                model.state.value.filters.tags,
            )
            assertEquals("old", model.state.value.query)
            compose.waitForIdle()
            assertEquals(requests, server.paths.count { it.contains("/assets?") })
            main { model.back() }
            assertEquals("old", model.state.value.searchDraft)
            assertEquals(setOf("tag0"), model.state.value.filters.tags)
            main { model.logout() }
        }
    }

    @Test
    fun partialOptionFailuresDoNotEraseOtherSectionsAndDatesNeedNoCatalogRequest() {
        Server().use { server ->
            server.mediaStatus = 503
            val model = model(server)
            main { model.openFilters("筛选") }
            await { !model.state.value.optionsLoading }
            assertEquals(3, model.state.value.options.tags.size)
            assertEquals(listOf("Camera A"), model.state.value.options.cameras)
            assertNotNull(model.state.value.optionStatus[NativeOptionSection.FORMATS]?.error)
            assertNull(model.state.value.optionStatus[NativeOptionSection.TAGS]?.error)
            server.mediaStatus = 200
            main { model.openFilters("格式") }
            await { !model.state.value.optionsLoading }
            assertEquals(listOf("jpeg", "mp4", "png"), model.state.value.options.formats)
            assertEquals(3, model.state.value.options.tags.size)
            assertEquals(listOf("Lens B"), model.state.value.options.lenses)
            val requests = server.paths.size
            main {
                model.openFilters("时间")
                model.closePanel()
                model.openFilters("评分")
            }
            compose.waitForIdle()
            assertEquals(requests, server.paths.size)
            main { model.logout() }
        }
    }

    @Test
    fun choicesAccumulateInDraftThenSubmitTogetherAndRemainModeScoped() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main {
                model.openSearch()
                model.updateSearchDraft("new keyword")
                model.openFilters("标签")
            }
            await { !model.state.value.optionsLoading }
            compose.onNodeWithText("标签1").performClick()
            compose.onNodeWithTag("filter-submit").performClick()
            assertTrue(model.state.value.searchOpen)
            assertTrue(model.state.value.filters.tags.isEmpty())
            main { model.openFilters("格式") }
            await { !model.state.value.optionsLoading }
            compose.onNodeWithText("PNG").performClick()
            compose.onNodeWithTag("filter-submit").performClick()
            compose.onNodeWithTag("condition:tag:tag1").assertExists()
            compose.onNodeWithTag("condition:format:png").assertExists()
            compose.onNodeWithTag("search-submit").assertIsDisplayed().performClick()
            await { !model.state.value.loading }
            assertEquals("new keyword", model.state.value.query)
            assertEquals(setOf("tag1"), model.state.value.filters.tags)
            assertEquals(setOf("png"), model.state.value.filters.formats)
            assertTrue(
                server.paths.any {
                    it.startsWith("/api/photos/assets?") &&
                        it.contains("manualTagIds=tag1") &&
                        it.contains("formats=png") &&
                        it.contains("search=new+keyword")
                }
            )
            main { model.switchMode(GalleryMode.MATERIAL) }
            assertTrue(model.state.value.filters.tags.isEmpty())
            main { model.openFilters("相机") }
            await { !model.state.value.optionsLoading }
            assertFalse(server.paths.any { it.contains("/api/eagle/photography") })
            main { model.switchMode(GalleryMode.PHOTO) }
            assertEquals(setOf("tag1"), model.state.value.filters.tags)
            main {
                model.openSearch()
                model.openFilters("标签")
            }
            await { !model.state.value.optionsLoading }
            compose.onNodeWithText("标签2").performClick()
            compose.onNodeWithText("取消").performClick()
            assertEquals(setOf("tag1"), model.state.value.searchFilters.tags)
            main {
                model.back()
                model.logout()
            }
        }
    }

    @Test
    fun cameraLensRatingAndGpsCanBeEditedTogetherWithoutChangingTheKeyword() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main {
                model.openSearch()
                model.updateSearchDraft("flower")
                model.openFilters("筛选")
            }
            await { !model.state.value.optionsLoading }
            compose.onNodeWithText("Camera A").performScrollTo().performClick()
            compose.onNodeWithText("Lens B").performScrollTo().performClick()
            compose.onNodeWithText("4 ★").performScrollTo().performClick()
            compose.onNodeWithText("有 GPS").performScrollTo().performClick()
            compose.waitForIdle()
            captureNativeEvidence("native-search-combined.png")
            compose.onNodeWithTag("filter-submit").assertIsDisplayed().performClick()
            assertEquals("flower", model.state.value.searchDraft)
            compose.onNodeWithTag("search-submit").assertIsDisplayed().performClick()
            await { !model.state.value.loading }
            val filters = model.state.value.filters
            assertEquals("Camera A", filters.camera)
            assertEquals("Lens B", filters.lens)
            assertEquals(4, filters.rating)
            assertEquals("WITH", filters.gps)
            assertTrue(
                server.paths.any {
                    it.contains("cameraModel=Camera+A") &&
                        it.contains("lensModel=Lens+B") &&
                        it.contains("rating=4") &&
                        it.contains("gps=WITH")
                }
            )
            main { model.logout() }
        }
    }

    @Test
    fun largerTagBudgetDoesNotChangeOrdinaryJsonLimitsOrImageMimeValidation() {
        Server(9000).use { server ->
            val model = model(server)
            val connection = model.repository!!.connection
            assertThrows(java.io.IOException::class.java) {
                connection.array("/api/photos/manual-tags")
            }
            assertThrows(java.io.IOException::class.java) {
                connection.media("/api/photos/manual-tags")
            }
            assertThrows(IllegalArgumentException::class.java) {
                connection.array("/api/photos/manual-tags", 17 * 1024 * 1024)
            }
            assertEquals(
                9000,
                connection.array("/api/photos/manual-tags", 16 * 1024 * 1024).length(),
            )
            main { model.logout() }
            assertThrows(NativeSession.Failure::class.java) {
                connection.array("/api/photos/manual-tags", 16 * 1024 * 1024)
            }
        }
    }

    @Test
    fun cancellingASlowTagLookupAllowsTheNextOptionRequestImmediately() {
        Server().use { server ->
            server.tagDelay = 3000L
            val model = model(server)
            main { model.openFilters("标签") }
            await { server.paths.any { it.contains("manual-tags") } }
            main {
                model.closePanel()
                model.openFilters("格式")
            }
            compose.waitUntil(1500) { !model.state.value.optionsLoading }
            assertEquals(listOf("jpeg", "mp4", "png"), model.state.value.options.formats)
            assertTrue(model.state.value.options.tags.isEmpty())
            main { model.logout() }
        }
    }

    @Test
    fun blankSearchSpaceCannotTapThroughToTheGallery() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            val assetY =
                compose.onNodeWithTag("asset:asset").fetchSemanticsNode().boundsInRoot.center.y
            main { model.openSearch() }
            val searchTop =
                compose.onNodeWithTag("native-search").fetchSemanticsNode().boundsInRoot.top
            compose.onNodeWithTag("native-search").performTouchInput {
                click(androidx.compose.ui.geometry.Offset(2f, assetY - searchTop))
            }
            assertNull(
                "Search must consume touches in its padding, without opening the underlying photo",
                model.state.value.viewerId,
            )
            assertTrue(model.state.value.searchOpen)
            compose.onNodeWithTag("native-grid").assertDoesNotExist()
            main { model.logout() }
        }
    }

    @Test
    fun refreshFailureRetriesTheCurrentSearchEvenWhenThereIsNoNextPage() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main { model.search("flower", NativeFilters(formats = setOf("png"))) }
            await { !model.state.value.loading }
            server.assetStatus = 503
            main { model.refresh() }
            await { model.state.value.error != null }
            assertEquals(1, model.state.value.items.size)
            assertNull(model.state.value.cursor)
            server.assetStatus = 200
            compose.onNodeWithText("重试").performScrollTo().performClick()
            compose.waitUntil(1500) {
                model.state.value.error == null && !model.state.value.loading
            }
            assertEquals("flower", model.state.value.query)
            assertEquals(setOf("png"), model.state.value.filters.formats)
            main { model.logout() }
        }
    }

    @Test
    fun failingNextSearchPageWaitsForAnExplicitRetry() {
        Server(assetCount = 120).use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main { model.search("flower") }
            await { !model.state.value.loading }
            server.assetStatus = 503
            server.assetDelay = 80L
            compose.onNodeWithTag("native-grid").performScrollToIndex(50)
            await {
                server.paths.any {
                    it.startsWith("/api/photos/assets?") && it.contains("cursor=60")
                }
            }
            repeat(5) {
                Thread.sleep(100)
                compose.waitForIdle()
            }
            val failures =
                server.paths.count {
                    it.startsWith("/api/photos/assets?") && it.contains("cursor=60")
                }
            main { model.logout() }
            assertEquals(
                "An unavailable server must not trigger an automatic retry loop",
                1,
                failures,
            )
        }
    }

    @Test
    fun tagConfirmationIsVisibleAboveTheKeyboardAndSearchResultsStayReachable() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main {
                model.openSearch()
                model.openFilters("标签")
            }
            await { !model.state.value.optionsLoading }
            compose.onNodeWithTag("tag-search").performTextInput("bq1")
            await { compose.onAllNodesWithText("标签1").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("标签1").performClick()
            val submit =
                compose
                    .onNodeWithTag("filter-submit")
                    .assertIsDisplayed()
                    .fetchSemanticsNode()
                    .boundsInRoot
            val input = compose.onNodeWithTag("tag-search").fetchSemanticsNode().boundsInRoot
            assertTrue(
                "Confirmation must stay in the sheet header above the keyboard and list",
                submit.bottom <= input.top,
            )
            captureNativeEvidence("native-tag-confirm-header.png")
            compose.onNodeWithTag("filter-submit").performClick()
            await {
                compose.onAllNodesWithTag("native-filter-sheet").fetchSemanticsNodes().isEmpty()
            }
            captureNativeEvidence("native-search-fixed-submit.png")
            compose.onNodeWithTag("search-submit").assertIsDisplayed().performClick()
            await { !model.state.value.loading && !model.state.value.searchOpen }
            assertEquals(setOf("tag1"), model.state.value.filters.tags)
            assertTrue(server.paths.last { it.contains("/assets?") }.contains("manualTagIds=tag1"))
            main { model.logout() }
        }
    }

    @Test
    fun pullingDownRefreshesTheCurrentSearchAndKeepsItsFilters() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            main {
                model.search("flower", NativeFilters(tags = setOf("tag1"), formats = setOf("png")))
            }
            await { !model.state.value.loading }
            val requests = server.paths.count { it.contains("/assets?") }
            compose.onNodeWithTag("native-grid").performTouchInput {
                swipeDown(startY = height * 0.2f, endY = height * 0.85f, durationMillis = 600)
            }
            compose.waitUntil(3000) { server.paths.count { it.contains("/assets?") } > requests }
            await { !model.state.value.loading }
            assertEquals("flower", model.state.value.query)
            assertEquals(setOf("tag1"), model.state.value.filters.tags)
            val path = server.paths.last { it.contains("/assets?") }
            assertTrue(
                path.contains("manualTagIds=tag1") &&
                    path.contains("formats=png") &&
                    path.contains("search=flower")
            )
            main { model.logout() }
        }
    }

    @Test
    fun emptyLibraryPullRefreshHandlesFailureAndModeSwitchWithoutDuplicateRequests() {
        Server(assetCount = 0).use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            server.assetStatus = 503
            compose.onNodeWithTag("native-grid").performTouchInput {
                swipeDown(durationMillis = 600)
            }
            await { model.state.value.error != null }
            assertFalse(model.state.value.refreshing)
            assertTrue(model.state.value.items.isEmpty())
            server.assetStatus = 200
            compose.onNodeWithText("重试").assertIsDisplayed().performClick()
            await { model.state.value.error == null && !model.state.value.loading }
            main { model.switchMode(GalleryMode.MATERIAL) }
            await { !model.state.value.loading }
            server.assetDelay = 2000
            val before = server.paths.count { it.startsWith("/api/eagle/assets?") }
            compose.onNodeWithTag("native-grid").performTouchInput {
                swipeDown(durationMillis = 600)
            }
            await { model.state.value.refreshing }
            compose.onNodeWithTag("native-grid").performTouchInput {
                swipeDown(durationMillis = 300)
            }
            assertEquals(before + 1, server.paths.count { it.startsWith("/api/eagle/assets?") })
            main { model.switchMode(GalleryMode.PHOTO) }
            await { !model.state.value.loading }
            assertFalse(model.state.value.refreshing)
            assertEquals(GalleryMode.PHOTO, model.state.value.mode)
            main { model.logout() }
        }
    }

    private fun hasTestTagPrefix(prefix: String) =
        SemanticsMatcher("tag starts $prefix") {
            it.config
                .getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }
                .startsWith(prefix)
        }
}
