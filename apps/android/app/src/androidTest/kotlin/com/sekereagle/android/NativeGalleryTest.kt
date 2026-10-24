package com.sekereagle.android

import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.rules.ExternalResource

/** Real Compose + existing HTTP auth/API, isolated workbench only. No fixture login in the app. */
class NativeGalleryTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var credentials: JSONObject
    @get:Rule(order = 0)
    val preparation =
        object : ExternalResource() {
            override fun before() {
                credentials =
                    JSONObject(
                        instrumentation.context.assets
                            .open("native-test-credentials.json")
                            .bufferedReader()
                            .use { it.readText() }
                    )
                val origin = InstrumentationRegistry.getArguments().getString("origin")
                assertTrue(origin.orEmpty().matches(Regex("http://localhost:[0-9]+")))
                assertEquals(origin, credentials.getString("origin"))
                BackupSettings(context).origin(origin!!)
                NativeSession.open(context, origin).clear()
            }
        }
    @get:Rule(order = 1) val compose = createAndroidComposeRule<NativeActivity>()

    private fun login() {
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("native-origin").fetchSemanticsNodes().isNotEmpty()
        }
        compose
            .onNodeWithTag("native-origin")
            .performTextReplacement(credentials.getString("origin"))
        compose.onNodeWithTag("native-email").performTextInput(credentials.getString("email"))
        compose.onNodeWithTag("native-password").performTextInput(credentials.getString("password"))
        // Exercise real login without exceeding the server's five-per-minute security limit.
        TestLoginThrottle.await()
        compose.onNodeWithTag("native-login").performClick()
        compose.waitUntil(20_000) {
            compose.onAllNodesWithTag("native-library").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithTag("native-error").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("native-error").assertDoesNotExist()
        assertFalse(
            "The native launcher must never create a WebView",
            hasWebView(compose.activity.window.decorView),
        )
    }

    private fun hasWebView(view: View): Boolean =
        view is WebView ||
            (view is ViewGroup && (0 until view.childCount).any { hasWebView(view.getChildAt(it)) })

    private fun back() {
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.waitForIdle()
    }

    private fun firstAsset(): String {
        compose.waitUntil(20_000) {
            compose.onAllNodes(hasTestTagPrefix("asset:")).fetchSemanticsNodes().isNotEmpty()
        }
        return compose
            .onAllNodes(hasTestTagPrefix("asset:"))
            .fetchSemanticsNodes()
            .first()
            .config[androidx.compose.ui.semantics.SemanticsProperties.TestTag]
            .removePrefix("asset:")
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        Thread.sleep(250)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        java.io.File(context.getExternalFilesDir(null), name).outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun verifyOriginalDownloads() {
        val session = NativeSession.open(context, credentials.getString("origin"))
        val collection = android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI
        fun rows(): Set<android.net.Uri> =
            context.contentResolver
                .query(
                    collection,
                    arrayOf("_id"),
                    "relative_path = ?",
                    arrayOf("Download/SekerEagle/"),
                    null,
                )!!
                .use { cursor ->
                    buildSet {
                        while (cursor.moveToNext()) add(
                            android.content.ContentUris.withAppendedId(
                                collection,
                                cursor.getLong(0),
                            )
                        )
                    }
                }
        val before = rows()
        try {
            val first = firstAsset()
            compose.onNodeWithTag("asset:$first").performTouchInput { longClick() }
            compose.onNodeWithText("下载").performClick()
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("下载结果").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("download-summary").assertTextEquals("已保存 1 / 1 项")
            capture("native-single-download.png")
            val savedSingle = rows() - before
            assertEquals(1, savedSingle.size)
            assertArrayEquals(
                session.media("/api/photos/assets/$first/original"),
                context.contentResolver.openInputStream(savedSingle.first())!!.use {
                    it.readBytes()
                },
            )
            compose.onNodeWithText("完成").performClick()
            compose.onNodeWithTag("native-download-dialog").assertDoesNotExist()
            compose.onNodeWithContentDescription("取消选择").performClick()
            compose.onNodeWithTag("native-selection-count").assertDoesNotExist()
            val ids =
                compose.onAllNodes(hasTestTagPrefix("asset:")).fetchSemanticsNodes().take(2).map {
                    it.config[androidx.compose.ui.semantics.SemanticsProperties.TestTag]
                        .removePrefix("asset:")
                }
            assertEquals(2, ids.size)
            compose.onNodeWithTag("asset:${ids[0]}").performTouchInput { longClick() }
            capture("native-download-selection-first.png")
            compose.onNodeWithTag("native-selection-count").assertTextEquals("已选择 1 项")
            compose.onNodeWithTag("asset:${ids[1]}").performClick()
            capture("native-download-selection-second.png")
            compose.onNodeWithTag("native-selection-count").assertTextEquals("已选择 2 项")
            compose.onNodeWithText("下载").performClick()
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("下载结果").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("download-summary").assertTextEquals("已保存 2 / 2 项")
            val savedBatch = rows() - before - savedSingle
            assertEquals(2, savedBatch.size)
            fun digest(data: ByteArray) =
                java.security.MessageDigest.getInstance("SHA-256").digest(data).toList()
            val expected =
                ids.map { digest(session.media("/api/photos/assets/$it/original")) }
                    .sortedBy { it.toString() }
            val actual =
                savedBatch
                    .map {
                        digest(
                            context.contentResolver.openInputStream(it)!!.use { input ->
                                input.readBytes()
                            }
                        )
                    }
                    .sortedBy { it.toString() }
            assertEquals(expected, actual)
            capture("native-multi-download.png")
            compose.onNodeWithText("完成").performClick()
            compose.onNodeWithTag("native-download-dialog").assertDoesNotExist()
            back()
            compose.onNodeWithTag("native-selection-count").assertDoesNotExist()
            val original =
                NativeGalleryRepository(session, "download-test")
                    .parse(session.json("GET", "/api/photos/assets/$first"), GalleryMode.PHOTO)
            val filesBeforeWrongMode = rows()
            val failure =
                assertThrows(NativeSession.Failure::class.java) {
                    NativeDownloadStore(context).save(
                        session,
                        GalleryMode.MATERIAL,
                        original,
                        NativeTransferCancellation(),
                    ) { _, _ ->
                    }
                }
            assertEquals(404, failure.status)
            assertEquals(filesBeforeWrongMode, rows())
        } finally {
            (rows() - before).forEach { context.contentResolver.delete(it, null, null) }
        }
    }

    @Test
    fun filtersAndLongPressBatchTagsTrashAndRestoreUseRealApi() {
        login()
        val first = firstAsset()
        val session = NativeSession.open(context, credentials.getString("origin"))
        val tag =
            session.json(
                "POST",
                "/api/photos/manual-tags",
                JSONObject().put("name", "原生多选测试-${System.nanoTime()}"),
            )
        val name = tag.getString("name")
        val tagId = tag.getString("id")
        compose.onNodeWithTag("asset:$first").performTouchInput { longClick() }
        compose.onNodeWithTag("native-selection-count").assertTextEquals("已选择 1 项")
        capture("native-selection.png")
        compose.onNodeWithText("加标签").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText(name).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(name).performScrollTo().performClick()
        compose.onNodeWithText("应用").performScrollTo().performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("native-selection-count").fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithTag("asset:$first").performTouchInput { longClick() }
        compose.onNodeWithText("评分").performClick()
        compose.onNodeWithText("3 ★").performScrollTo().performClick()
        compose.onNodeWithText("应用").performScrollTo().performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("native-selection-count").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(3, session.json("GET", "/api/photos/assets/$first").getInt("rating"))
        val filtered = session.json("GET", "/api/photos/assets?manualTagIds=$tagId")
        assertTrue(
            (0 until filtered.getJSONArray("items").length()).any {
                filtered.getJSONArray("items").getJSONObject(it).getString("id") == first
            }
        )
        compose.onNodeWithContentDescription("视图选项").performClick()
        compose.onNodeWithText("标签").assertDoesNotExist()
        compose.onNodeWithText("相机").assertDoesNotExist()
        compose.onNodeWithText("3 列网格").assertExists()
        back()
        compose.onNodeWithContentDescription("搜索").performClick()
        val keyword = session.json("GET", "/api/photos/assets/$first").getString("displayName")
        compose.onNodeWithTag("search-input").performTextInput(keyword)
        compose.onNodeWithText("相机").assertExists()
        capture("native-search-entry.png")
        compose.onNodeWithText("标签", useUnmergedTree = true).performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText(name).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(name).performScrollTo().performClick()
        capture("native-filter.png")
        compose.onNodeWithTag("filter-submit").performScrollTo().performClick()
        compose.onNodeWithTag("native-search").assertExists()
        compose.onNodeWithTag("search-submit").performScrollTo().performClick()
        compose.waitUntil {
            compose.onAllNodesWithTag("native-search-results").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("condition:tag:$tagId").assertExists()
        compose.onNodeWithTag("condition:query").assertTextContains("关键词：$keyword")
        assertEquals(first, firstAsset())
        capture("native-search-results.png")
        compose.onNodeWithTag("condition:tag:$tagId").performClick()
        compose.onNodeWithTag("condition:tag:$tagId").assertDoesNotExist()
        compose.onNodeWithTag("condition:query").assertExists()
        compose.onNodeWithText("修改条件").performClick()
        compose.onNodeWithTag("search-input").assertTextEquals(keyword)
        compose.onNodeWithText("格式", useUnmergedTree = true).performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("PNG").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("PNG").performScrollTo().performClick()
        compose.onNodeWithText("JPEG").performScrollTo().performClick()
        compose.onNodeWithTag("filter-submit").performScrollTo().performClick()
        compose.onNodeWithTag("native-search").assertExists()
        compose.onNodeWithTag("search-submit").performScrollTo().performClick()
        compose.waitUntil {
            compose.onAllNodesWithTag("native-search-results").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("condition:format:png").assertExists()
        compose.onNodeWithTag("condition:format:jpeg").assertExists()
        compose.onNodeWithTag("condition:format:jpeg").performClick()
        compose.onNodeWithTag("condition:format:jpeg").assertDoesNotExist()
        compose.onNodeWithTag("condition:format:png").assertExists()
        compose.onNodeWithTag("condition:format:png").performClick()
        assertEquals(first, firstAsset())
        compose.onNodeWithTag("asset:$first").performTouchInput { longClick() }
        compose.onNodeWithText("删除").performClick()
        compose.onNodeWithText("移入回收站").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("native-selection-count").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(
            0,
            session
                .json("GET", "/api/photos/assets?manualTagIds=$tagId")
                .getJSONArray("items")
                .length(),
        )
        back() // clear active filter
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("最近删除").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("asset:$first").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("asset:$first").performTouchInput { longClick() }
        compose.onNodeWithText("恢复").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("native-selection-count").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(
            1,
            session
                .json("GET", "/api/photos/assets?manualTagIds=$tagId")
                .getJSONArray("items")
                .length(),
        )
        back()
        val restored = firstAsset()
        compose.onNodeWithTag("asset:$restored").performTouchInput { longClick() }
        compose.onNodeWithText("全选已加载").performClick()
        assertTrue(
            compose
                .onNodeWithTag("native-selection-count")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.Text]
                .joinToString()
                .contains("项")
        )
        back()
        compose.onNodeWithTag("native-selection-count").assertDoesNotExist()
        verifyOriginalDownloads()
        NativeUploadJourney(compose, context, session).verify()
        compose.onNodeWithTag("mode:MATERIAL").performClick()
        compose.onNodeWithContentDescription("视图选项").performClick()
        compose.onNodeWithText("标签").assertDoesNotExist()
        back()
        compose.onNodeWithContentDescription("搜索").performClick()
        compose.onNodeWithText("相机").assertDoesNotExist()
        compose.onNodeWithText("标签").assertExists()
        capture("native-search-conditions.png")
        back()
        assertFalse(compose.activity.isFinishing)
        val repo = NativeGalleryRepository(session, "instrumentation")
        val asset = repo.parse(session.json("GET", "/api/photos/assets/$first"), GalleryMode.PHOTO)
        try {
            kotlinx.coroutines.runBlocking {
                repo.change(GalleryMode.MATERIAL, listOf(asset), "trash")
            }
            fail("Cross-mode batch mutation must be rejected")
        } catch (e: NativeSession.Failure) {
            assertEquals(404, e.status)
        }
        kotlinx.coroutines.runBlocking {
            repo.change(GalleryMode.PHOTO, listOf(asset), "rating", rating = 4)
        }
        try {
            kotlinx.coroutines.runBlocking {
                repo.change(GalleryMode.PHOTO, listOf(asset), "rating", rating = 2)
            }
            fail("Stale row versions must be rejected")
        } catch (e: NativeSession.Failure) {
            assertEquals(409, e.status)
        }
        assertEquals(4, session.json("GET", "/api/photos/assets/$first").getInt("rating"))
    }

    @Test
    fun nativeLoginListZoomSwipeSearchAndBack() {
        login()
        firstAsset()
        val current =
            androidx.lifecycle
                .ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
                .state
                .value
        val startIndex = current.items.indexOfFirst { !it.video }
        assertTrue("The seeded gallery must contain a photo for zoom gestures", startIndex >= 0)
        val first = current.items[startIndex].id
        capture("native-home.png")
        compose.onNodeWithTag("asset:$first").performClick()
        compose.onNodeWithTag("native-viewer").assertExists()
        compose.onNodeWithTag("viewer-photo:$first").performTouchInput { doubleClick() }
        compose.waitUntil {
            compose
                .onNodeWithTag("viewer-photo:$first")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription] ==
                "zoom:2.5"
        }
        compose.onNodeWithTag("viewer-photo:$first").performTouchInput { doubleClick() }
        compose.waitUntil {
            compose
                .onNodeWithTag("viewer-photo:$first")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription] ==
                "zoom:1.0"
        }
        compose.onNodeWithTag("viewer-photo:$first").performTouchInput {
            pinch(
                start0 = center + androidx.compose.ui.geometry.Offset(-80f, 0f),
                end0 = center + androidx.compose.ui.geometry.Offset(-210f, 0f),
                start1 = center + androidx.compose.ui.geometry.Offset(80f, 0f),
                end1 = center + androidx.compose.ui.geometry.Offset(210f, 0f),
            )
        }
        compose.waitUntil {
            compose
                .onNodeWithTag("viewer-photo:$first")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]
                .removePrefix("zoom:")
                .toFloat() > 1.2f
        }
        compose.onNodeWithTag("viewer-photo:$first").performTouchInput { doubleClick() }
        compose.waitForIdle()
        capture("native-viewer.png")
        compose.onNodeWithTag("native-viewer").performTouchInput { swipeLeft() }
        compose.waitUntil {
            androidx.lifecycle
                .ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
                .state
                .value
                .viewerId == current.items[startIndex + 1].id
        }
        back()
        compose.onNodeWithTag("native-viewer").assertDoesNotExist()
        assertFalse(compose.activity.isFinishing)
        compose.onNodeWithContentDescription("搜索").performClick()
        compose.onNodeWithTag("search-input").performTextInput("public-sample")
        compose.onNodeWithTag("search-input").performImeAction()
        compose.onNodeWithTag("native-search").assertDoesNotExist()
        back()
        compose.onNodeWithTag("native-library").assertExists()
        compose.onNodeWithTag("mode:MATERIAL").performClick()
        firstAsset()
        compose.onNodeWithTag("mode:PHOTO").performClick()
        firstAsset()
        compose.onNodeWithContentDescription("搜索").performClick()
        compose.onNodeWithTag("native-search").assertIsDisplayed()
        capture("native-search.png")
        compose.onNodeWithContentDescription("关闭搜索").performClick()
        compose.onNodeWithContentDescription("更多操作").performClick()
        capture("native-flat-menu.png")
        compose.onNodeWithText("账号与连接", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("native-account").assertExists()
        capture("native-account.png")
        back()
        assertFalse(compose.activity.isFinishing)
        compose.onNodeWithTag("native-library").assertExists()
    }

    @Test
    fun dateOrderingIsIndependentPersistentAndSearchHasNoExampleSuggestions() {
        login()
        firstAsset()
        fun currentModel() =
            androidx.lifecycle
                .ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
        val session = NativeSession.open(context, credentials.getString("origin"))
        fun choose(label: String) {
            compose.onNodeWithContentDescription("视图选项").performClick()
            compose.onNodeWithText(label).performClick()
            compose.waitUntil(15_000) {
                !currentModel().state.value.loading
            }
        }
        fun verify(mode: String, sort: String) {
            val base = com.sekereagle.android.core.NativeGalleryPolicy.base(mode)
            val expected =
                session.json("GET", "$base/assets?limit=60&sort=$sort").getJSONArray("items")
            compose.waitUntil(15_000) {
                !currentModel().state.value.loading
            }
            assertEquals(
                (0 until expected.length()).map { expected.getJSONObject(it).getString("id") },
                currentModel().state.value.items.map { it.id },
            )
        }
        choose("按添加时间排序")
        verify("PHOTO", "ADDED_AT")
        compose.onNodeWithText("素材", useUnmergedTree = true).performClick()
        firstAsset()
        choose("按拍摄时间排序")
        verify("MATERIAL", "CAPTURED_AT")
        compose.onNodeWithText("照片", useUnmergedTree = true).performClick()
        firstAsset()
        verify("PHOTO", "ADDED_AT")
        compose.activityRule.scenario.recreate()
        firstAsset()
        val restored = currentModel()
        // Rebuild authenticated state as on a fresh process, instead of relying on retained state.
        compose.runOnUiThread { restored.restore() }
        firstAsset()
        assertEquals(GallerySort.ADDED_AT, restored.state.value.sort)
        val settings = BackupSettings(context)
        assertEquals(
            GallerySort.CAPTURED_AT,
            GallerySort.restore(settings, "unrelated-account", GalleryMode.PHOTO),
        )
        assertEquals(
            GallerySort.ADDED_AT,
            GallerySort.restore(settings, "unrelated-account", GalleryMode.MATERIAL),
        )
        compose.onNodeWithText("素材", useUnmergedTree = true).performClick()
        firstAsset()
        assertEquals(GallerySort.CAPTURED_AT, restored.state.value.sort)
        verify("MATERIAL", "CAPTURED_AT")
        compose.onNodeWithContentDescription("搜索").performClick()
        compose.onNodeWithText("试试搜索").assertDoesNotExist()
        compose.onNodeWithText("旅行").assertDoesNotExist()
        compose.onNodeWithText("搜索历史").assertExists()
        capture("native-search-without-suggestions.png")
        back()
        if (compose.onAllNodesWithTag("native-search").fetchSemanticsNodes().isNotEmpty()) back()
        compose.onNodeWithTag("native-search").assertDoesNotExist()
        compose.onNodeWithContentDescription("视图选项").performClick()
        compose.onNodeWithText("按添加时间排序").assertIsDisplayed()
        capture("native-date-order-menu.png")
        // Leave defaults for unrelated journeys after verifying actual keyboard/back navigation.
        compose.onNodeWithText("按添加时间排序").performClick()
        compose.onNodeWithText("照片", useUnmergedTree = true).performClick()
        firstAsset()
        choose("按拍摄时间排序")
        compose.waitUntil(15000) { currentModel().state.value.timeline != null }
        val index = currentModel().state.value.timeline!!
        val oldest = index.days.last()
        compose.runOnUiThread { currentModel().jumpToDay(oldest) }
        compose.waitUntil(15000) {
            !currentModel().state.value.loading && currentModel().state.value.items.isNotEmpty()
        }
        assertEquals(oldest.label, currentModel().state.value.items.first().groupDate)
        assertEquals(oldest.offset, currentModel().state.value.windowOffset)
        capture("native-timeline-position.png")
        if (oldest.offset > 0) {
            compose.waitUntil(15000) { currentModel().state.value.timeline != null }
            val anchor = currentModel().state.value.items.first().id
            compose.runOnUiThread { currentModel().loadPrevious() }
            compose.waitUntil(15000) { !currentModel().state.value.loading }
            assertTrue(currentModel().state.value.items.any { it.id == anchor })
            assertEquals(
                (oldest.offset - 60).coerceAtLeast(0),
                currentModel().state.value.windowOffset,
            )
        }
        compose.runOnUiThread { currentModel().load() }
        firstAsset()
    }

    @Test
    fun modesUseIndependentResourcesAndLogoutClearsNativeFlow() {
        fun currentModel() =
            androidx.lifecycle
                .ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
        login()
        firstAsset()
        val session = NativeSession.open(context, credentials.getString("origin"))
        val photos = session.json("GET", "/api/photos/assets?limit=60")
        val materials = session.json("GET", "/api/eagle/assets?limit=60")
        val photoIds =
            (0 until photos.getJSONArray("items").length())
                .map { photos.getJSONArray("items").getJSONObject(it).getString("id") }
                .toSet()
        val materialIds =
            (0 until materials.getJSONArray("items").length())
                .map { materials.getJSONArray("items").getJSONObject(it).getString("id") }
                .toSet()
        assertTrue(photoIds.isNotEmpty())
        assertTrue(materialIds.isNotEmpty())
        assertTrue(photoIds.intersect(materialIds).isEmpty())
        compose.onNodeWithTag("native-library").performTouchInput { swipeLeft() }
        compose.waitUntil(10_000) {
            currentModel().state.value.mode == GalleryMode.MATERIAL &&
                !currentModel().state.value.loading
        }
        assertTrue(currentModel().state.value.items.all { it.id in materialIds })
        capture("native-library-materials.png")
        compose.onNodeWithTag("native-library").performTouchInput { swipeRight() }
        compose.waitUntil(10_000) {
            currentModel().state.value.mode == GalleryMode.PHOTO &&
                !currentModel().state.value.loading
        }
        assertTrue(currentModel().state.value.items.all { it.id in photoIds })
        capture("native-library-photos.png")
        val settings = BackupSettings(context)
        val encrypted =
            settings.value("native-session:${credentials.getString("origin")}", "credential", "")
        assertTrue(encrypted.isNotEmpty())
        assertFalse(encrypted.contains("sekereagle_access"))
        assertFalse(encrypted.contains(credentials.getString("password")))
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("账号与连接", useUnmergedTree = true).performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("native-login").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("native-library").assertDoesNotExist()
        assertEquals("", settings.active())
        assertEquals(
            "",
            settings.value("native-session:${credentials.getString("origin")}", "credential", ""),
        )
    }

    @Test
    fun backupAndCleanupReuseNativeScreensWithoutCreatingWebView() {
        login()
        for (label in listOf("备份设置", "释放手机空间")) {
            compose.onNodeWithContentDescription("更多操作").performClick()
            compose.onNodeWithText(label).performScrollTo().performClick()
            var child: android.app.Activity? = null
            compose.waitUntil(10000) {
                instrumentation.runOnMainSync {
                    child =
                        androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
                            .getInstance()
                            .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)
                            .firstOrNull { it is MainActivity }
                }
                child != null
            }
            instrumentation.runOnMainSync { assertFalse(hasWebView(child!!.window.decorView)) }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            compose.waitUntil(10000) {
                compose.onAllNodesWithTag("native-library").fetchSemanticsNodes().isNotEmpty()
            }
            assertFalse(compose.activity.isFinishing)
        }
    }

    @Test
    fun nativeRefreshRotatesCookiesAndRestrictsTheirPaths() {
        val server = java.net.ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val worker = Thread {
            try {
                val paths =
                    listOf(
                        "/api/auth/login",
                        "/api/auth/me",
                        "/api/photos/assets",
                        "/api/auth/refresh",
                        "/api/photos/assets",
                        "/api/auth/logout",
                    )
                paths.forEachIndexed { index, expected ->
                    server.accept().use { socket ->
                        socket.soTimeout = 10000
                        val input = socket.getInputStream().bufferedReader()
                        val line = input.readLine()
                        assertEquals(expected, line.split(" ")[1])
                        val headers = mutableMapOf<String, String>()
                        while (true) {
                            val header = input.readLine()
                            if (header.isEmpty()) break
                            headers[header.substringBefore(":").lowercase()] =
                                header.substringAfter(":").trim()
                        }
                        repeat(headers["content-length"]?.toInt() ?: 0) { input.read() }
                        if (index == 3)
                            assertEquals(
                                "sekereagle_access=old-access; sekereagle_refresh=old-refresh",
                                headers["cookie"],
                            )
                        if (index == 4)
                            assertEquals("sekereagle_access=new-access", headers["cookie"])
                        val body =
                            if (index == 1)
                                "{\"user\":{\"id\":\"owner\"},\"desktopCache\":{\"deploymentId\":\"test\"}}"
                            else "{}"
                        val cookies =
                            when (index) {
                                0 ->
                                    "Set-Cookie: sekereagle_access=old-access; Path=/\r\nSet-Cookie: sekereagle_refresh=old-refresh; Path=/api/auth\r\n"
                                3 ->
                                    "Set-Cookie: sekereagle_access=new-access; Path=/\r\nSet-Cookie: sekereagle_refresh=new-refresh; Path=/api/auth\r\n"
                                else -> ""
                            }
                        val response =
                            "HTTP/1.1 ${if(index==2)"401 Unauthorized" else "200 OK"}\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n$cookies\r\n$body"
                        socket.getOutputStream().write(response.toByteArray())
                    }
                }
            } catch (error: Throwable) {
                failure.set(error)
            } finally {
                server.close()
            }
        }
        worker.start()
        try {
            val session = NativeSession.open(context, "http://127.0.0.1:${server.localPort}")
            session.login("test@example.invalid", "test-only")
            session.json("GET", "/api/photos/assets")
            session.logout()
            worker.join(15000)
            failure.get()?.let { throw AssertionError("Session protocol failed", it) }
            assertFalse(worker.isAlive)
        } finally {
            server.close()
        }
    }

    @Test
    fun derivedMediaRejectsRedirectsHtmlAndOversizedBodies() {
        val server = java.net.ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val error = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val worker = Thread {
            try {
                repeat(3) { index ->
                    server.accept().use { socket ->
                        socket.soTimeout = 10000
                        val reader = socket.getInputStream().bufferedReader()
                        while (reader.readLine().isNotEmpty()) {}
                        val response =
                            when (index) {
                                0 ->
                                    "HTTP/1.1 302 Found\r\nLocation: https://foreign.invalid/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                                1 ->
                                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                                else ->
                                    "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 17825792\r\nConnection: close\r\n\r\n"
                            }
                        socket.getOutputStream().write(response.toByteArray())
                    }
                }
            } catch (reason: Throwable) {
                error.set(reason)
            } finally {
                server.close()
            }
        }
        worker.start()
        try {
            val session = NativeSession.open(context, "http://127.0.0.1:${server.localPort}")
            repeat(3) {
                try {
                    session.media("/api/photos/assets/image/renditions/preview/content")
                    fail("Unsafe media accepted")
                } catch (expected: java.io.IOException) {
                    assertTrue(expected.message.orEmpty().isNotEmpty())
                }
            }
            worker.join(15000)
            error.get()?.let { throw AssertionError(it) }
            assertFalse(worker.isAlive)
        } finally {
            server.close()
        }
    }

    @Test
    fun logoutImmediatelyInvalidatesAnInflightResponse() {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val accepted = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val worker = Thread {
            try {
                server.accept().use { socket ->
                    socket.soTimeout = 10000
                    val reader = socket.getInputStream().bufferedReader()
                    while (reader.readLine().isNotEmpty()) {}
                    accepted.countDown()
                    release.await(10, java.util.concurrent.TimeUnit.SECONDS)
                    socket
                        .getOutputStream()
                        .write(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: sekereagle_access=stale; Path=/\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                                .toByteArray()
                        )
                }
            } finally {
                server.close()
            }
        }
        worker.start()
        val origin = "http://127.0.0.1:${server.localPort}"
        val session = NativeSession.open(context, origin)
        val error = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val client = Thread {
            try {
                session.json("GET", "/api/photos/assets")
            } catch (reason: Throwable) {
                error.set(reason)
            }
        }
        client.start()
        try {
            assertTrue(accepted.await(10, java.util.concurrent.TimeUnit.SECONDS))
            session.invalidateLocally()
            assertEquals(
                "",
                BackupSettings(context).value("native-session:$origin", "credential", ""),
            )
            release.countDown()
            client.join(10000)
            worker.join(10000)
            assertFalse(client.isAlive)
            assertTrue(error.get() is NativeSession.Failure)
            assertEquals(
                "",
                BackupSettings(context).value("native-session:$origin", "credential", ""),
            )
        } finally {
            release.countDown()
            server.close()
        }
    }

    @Test
    fun previewSelectionUsesOnlyCurrentNonEditingRenditions() {
        val repo =
            NativeGalleryRepository(
                NativeSession.open(context, credentials.getString("origin")),
                "test-scope",
            )
        val asset =
            JSONObject()
                .put("id", "photo")
                .put("displayName", "Portrait")
                .put("mediaRevision", 2)
                .put("width", 1000)
                .put("height", 2000)
                .put("libraryAddedAt", "2026-10-22T01:00:00Z")
                .put(
                    "renditions",
                    org.json
                        .JSONArray()
                        .put(
                            JSONObject()
                                .put("id", "old")
                                .put("revision", 1)
                                .put("kind", "PREVIEW")
                                .put("mimeType", "image/webp")
                        )
                        .put(
                            JSONObject()
                                .put("id", "edit")
                                .put("revision", 2)
                                .put("kind", "PREVIEW")
                                .put("variant", "edit")
                                .put("mimeType", "image/webp")
                        )
                        .put(
                            JSONObject()
                                .put("id", "preview")
                                .put("revision", 2)
                                .put("kind", "PREVIEW")
                                .put("mimeType", "image/webp")
                        ),
                )
        val photo = repo.parse(asset, GalleryMode.PHOTO)
        val material = repo.parse(asset, GalleryMode.MATERIAL)
        assertEquals("/api/photos/assets/photo/renditions/preview/content", photo.preview)
        assertEquals("/api/eagle/assets/photo/renditions/preview/content", material.preview)
        assertEquals(1000, photo.width)
        assertEquals(2000, photo.height)
        asset.put("chronologicalAt", "2025-05-10T12:00:00Z")
        asset.put("photoMetadata", JSONObject().put("capturedLocal", "2025-05-10T12:00:00"))
        val captured = repo.parse(asset, GalleryMode.PHOTO, GallerySort.CAPTURED_AT)
        val added = repo.parse(asset, GalleryMode.PHOTO, GallerySort.ADDED_AT)
        assertEquals("2025年5月10日", captured.groupDate)
        assertEquals("2026年10月22日", added.groupDate)
        assertEquals(captured.date, added.date)
        assertEquals(captured.time, added.time)
    }

    @Test
    fun foregroundRevalidationClosesARevokedSession() {
        login()
        firstAsset()
        NativeSession.open(context, credentials.getString("origin"))
            .json("POST", "/api/auth/logout", JSONObject())
        compose.activityRule.scenario.recreate()
        compose.waitUntil(15000) {
            compose.onAllNodesWithTag("native-login").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("native-library").assertDoesNotExist()
        assertEquals("", BackupSettings(context).active())
    }

    private fun hasTestTagPrefix(prefix: String) =
        SemanticsMatcher("tag begins $prefix") {
            it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.TestTag) &&
                it.config[androidx.compose.ui.semantics.SemanticsProperties.TestTag].startsWith(
                    prefix
                )
        }
}
