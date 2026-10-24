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

    private class Server(val tagCount: Int = 3) : AutoCloseable {
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val paths = CopyOnWriteArrayList<String>()
        @Volatile var mediaStatus = 200
        @Volatile var photoStatus = 200
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
                        while (!socket.isClosed) socket.accept().use { client ->
                            client.soTimeout = 5000
                            val reader = client.getInputStream().bufferedReader()
                            val path = reader.readLine().split(" ")[1]
                            paths.add(path)
                            while (!reader.readLine().isNullOrEmpty()) {}
                            val status =
                                when {
                                    path.endsWith("media-capabilities") -> mediaStatus
                                    path.endsWith("photography/facets") -> photoStatus
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
                                    path.contains("/timeline") -> """{"days":[],"total":1}"""
                                    path.contains("/assets?") ->
                                        """{"items":[{"id":"asset","displayName":"photo","mediaRevision":1,"rowVersion":1,"renditions":[]}],"nextCursor":null}"""
                                    else -> "{}"
                                }
                            val bytes = body.toByteArray()
                            client
                                .getOutputStream()
                                .write(
                                    "HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                                        .toByteArray()
                                )
                            client.getOutputStream().write(bytes)
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            thread.join(6000)
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
            compose.onNodeWithTag("filter-submit").performClick()
            compose.onNodeWithTag("native-search").assertExists()
            compose.onNodeWithTag("search-submit").performScrollTo().performClick()
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

    private fun hasTestTagPrefix(prefix: String) =
        SemanticsMatcher("tag starts $prefix") {
            it.config
                .getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }
                .startsWith(prefix)
        }
}
