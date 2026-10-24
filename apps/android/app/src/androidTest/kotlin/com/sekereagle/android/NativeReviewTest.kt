package com.sekereagle.android

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated HTTP fixtures exercise state transitions without production accounts. */
class NativeReviewTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app
        get() = instrumentation.targetContext.applicationContext as Application

    private fun main(block: () -> Unit) = instrumentation.runOnMainSync(block)

    private fun await(condition: () -> Boolean) = compose.waitUntil(15000, condition)

    private class Server : AutoCloseable {
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val paths = CopyOnWriteArrayList<String>()
        @Volatile var version = 1
        private val thread =
            Thread {
                    try {
                        while (!socket.isClosed) socket.accept().use { client ->
                            client.soTimeout = 5000
                            val reader = client.getInputStream().bufferedReader()
                            val first = reader.readLine().split(" ")
                            val path = first[1]
                            paths.add(path)
                            var length = 0
                            while (true) {
                                val line = reader.readLine()
                                if (line.isEmpty()) break
                                if (line.startsWith("Content-Length:", true))
                                    length = line.substringAfter(':').trim().toInt()
                            }
                            repeat(length) { reader.read() }
                            val status = if (path == "/api/auth/login") 401 else 200
                            val body =
                                when {
                                    path == "/api/auth/me" ->
                                        """{"user":{"id":"owner","email":"test@example.invalid"},"desktopCache":{"deploymentId":"review"}}"""
                                    path.contains("/timeline") ->
                                        """{"days":[{"date":"2026-10-20","before":"2026-10-21T00:00:00Z","count":180,"offset":0}],"total":180}"""
                                    path.contains("/assets?") -> {
                                        val start =
                                            Regex("(?:cursor|offset)=([0-9]+)")
                                                .find(path)
                                                ?.groupValues
                                                ?.get(1)
                                                ?.toInt() ?: 0
                                        val items =
                                            (start until minOf(start + 60, 180)).joinToString(
                                                ","
                                            ) { i ->
                                                """{"id":"asset$i","displayName":"item$i","mediaRevision":1,"rowVersion":$version,"chronologicalAt":"2026-10-20T12:00:00Z","libraryAddedAt":"2026-10-21T12:00:00Z","renditions":[]}"""
                                            }
                                        """{"items":[$items],"nextCursor":${if (start + 60 < 180) "\"${start+60}\"" else "null"}}"""
                                    }
                                    else -> "{}"
                                }
                            client
                                .getOutputStream()
                                .write(
                                    "HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body"
                                        .toByteArray()
                                )
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            thread.join(6000)
        }
    }

    private fun model(server: Server, credential: Boolean = true): NativeGalleryViewModel {
        val settings = BackupSettings(app)
        settings.origin(server.origin)
        if (credential)
            settings.saveToken(
                "native-session:${server.origin}",
                JSONObject().put("sekereagle_access", "fixture").toString(),
            )
        lateinit var result: NativeGalleryViewModel
        main { result = NativeGalleryViewModel(app) }
        await { !result.state.value.restoring }
        if (credential)
            await { !result.state.value.loading && result.state.value.items.isNotEmpty() }
        return result
    }

    @Test
    fun viewerTapTogglesChromeAndOffersDirectActionsInBothModes() {
        Server().use { server ->
            val model = model(server)
            compose.setContent { NativeGalleryApp(model) {} }
            for (mode in GalleryMode.entries) {
                main { model.switchMode(mode) }
                await { !model.state.value.loading && model.state.value.items.isNotEmpty() }
                val asset = model.state.value.items.first()
                main { model.openAsset(asset.id) }
                compose.onNodeWithTag("viewer-top-bar").assertExists()
                for (label in listOf("删除", "编辑", "发送")) compose.onNodeWithContentDescription(label).assertExists()
                compose.onNodeWithContentDescription("照片信息").assertDoesNotExist()
                compose.onNodeWithText("1 / 60").assertDoesNotExist()
                compose.onNodeWithTag("viewer-photo:${asset.id}").performTouchInput { click() }
                compose.onNodeWithTag("viewer-top-bar").assertDoesNotExist()
                compose.onNodeWithTag("viewer-tools").assertDoesNotExist()
                compose.onNodeWithTag("viewer-photo:${asset.id}").performTouchInput { click() }
                compose.onNodeWithTag("viewer-tools").assertExists()
                compose.onNodeWithContentDescription("删除").performClick()
                compose.onNodeWithText("移入回收站？").assertExists()
                compose.onNodeWithText("取消").performClick()
                assertEquals(asset.id, model.state.value.viewerId)
                main { model.back() }
            }
        }
    }

    @Test
    fun commonActionsOpenDirectlyFromTheOverflowMenuInBothLibraries() {
        Server().use { server ->
            val model = model(server)
            val destinations = CopyOnWriteArrayList<String>()
            compose.setContent {
                val window = androidx.compose.ui.platform.LocalWindowInfo.current
                val height =
                    with(androidx.compose.ui.platform.LocalDensity.current) {
                        androidx.compose.ui.unit.Dp(280f).roundToPx()
                    }
                val compact =
                    object : androidx.compose.ui.platform.WindowInfo by window {
                        override val containerSize =
                            androidx.compose.ui.unit.IntSize(window.containerSize.width, height)
                    }
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.ui.platform.LocalWindowInfo provides compact
                ) {
                    NativeGalleryApp(model) { destinations.add(it) }
                }
            }
            for (mode in GalleryMode.entries) {
                compose.onNodeWithTag("mode:${mode.name}").performClick()
                await { !model.state.value.loading }
                compose.onNodeWithContentDescription("更多操作").performClick()
                compose.onNodeWithText("更多", useUnmergedTree = true).assertDoesNotExist()
                for (label in listOf("上传", "传输列表", "备份设置", "释放手机空间", "最近删除", "刷新", "账号与连接")) {
                    compose.onNodeWithText(label, useUnmergedTree = true).assertExists()
                }
                compose.onNodeWithText("备份设置").performScrollTo().performClick()
                assertEquals("backup", destinations.last())
                compose.onNodeWithTag("native-library").assertExists()
                compose.onNodeWithText("备份设置").assertDoesNotExist()
                compose.onNodeWithContentDescription("更多操作").performClick()
                compose.onNodeWithText("释放手机空间").performScrollTo().performClick()
                assertEquals("cleanup", destinations.last())
                compose.onNodeWithContentDescription("更多操作").performClick()
                compose.onNodeWithText("账号与连接").performScrollTo().performClick()
                compose.onNodeWithTag("native-account").assertExists()
                compose.onNodeWithText("test@example.invalid").assertExists()
                compose.onNodeWithText("退出登录").assertExists()
                compose.onNodeWithText("备份设置").assertDoesNotExist()
                compose.onNodeWithText("传输列表").assertDoesNotExist()
                compose.onNodeWithContentDescription("返回").performClick()
                compose.onNodeWithTag("native-library").assertExists()
            }
            main { model.logout() }
        }
    }

    @Test
    fun prependingInsideTheVisibleDayKeepsTheSamePhotoAtTheSamePosition() {
        Server().use { server ->
            val model = model(server)
            await { model.state.value.timeline?.days?.isNotEmpty() == true }
            main { model.jumpToDay(model.state.value.timeline!!.days.first(), 60) }
            await {
                !model.state.value.loading && model.state.value.items.firstOrNull()?.id == "asset60"
            }
            compose.setContent { NativeGalleryApp(model) {} }
            compose.onNodeWithTag("asset:asset60").assertIsDisplayed()
            val before =
                compose.onNodeWithTag("asset:asset60").fetchSemanticsNode().boundsInRoot.top
            main { model.loadPrevious() }
            await { !model.state.value.loading && model.state.value.windowOffset == 0L }
            compose.onNodeWithTag("asset:asset60").assertIsDisplayed()
            val after = compose.onNodeWithTag("asset:asset60").fetchSemanticsNode().boundsInRoot.top
            assertEquals(
                "Prepending must preserve the visible photo, including its date header",
                before,
                after,
                2f,
            )
            main { model.logout() }
        }
    }

    @Test
    fun refreshAndMutationKeepAllLoadedPagesAndVersions() {
        Server().use { server ->
            val model = model(server)
            repeat(2) {
                main { model.load(true) }
                await { !model.state.value.loading }
            }
            assertEquals(180, model.state.value.items.size)
            main {
                model.startSelection("asset0")
                model.selectLoaded((0 until 80).map { "asset$it" }.toSet())
                model.selectLoaded((80 until 160).map { "asset$it" }.toSet())
                assertEquals(100, model.state.value.selected.size)
                assertTrue(model.state.value.message.orEmpty().contains("100"))
                model.back()
            }
            server.version = 2
            main {
                model.startSelection("asset130")
                model.changeSelection("rating", rating = 3)
            }
            await { !model.state.value.busy && !model.state.value.loading }
            assertEquals(
                "Mutation must retain the loaded window",
                180,
                model.state.value.items.size,
            )
            assertEquals(2, model.state.value.items[130].rowVersion)
            main { model.refresh() }
            await { !model.state.value.loading }
            assertEquals(180, model.state.value.items.size)
            main {
                model.openTrash()
            }
            await { !model.state.value.loading }
            main {
                assertFalse(model.prepareUploadSelection())
                model.logout()
            }
        }
    }

    @Test
    fun cleanLaunchAndBadPasswordHaveDifferentLoginStates() {
        Server().use { server ->
            val model = model(server, false)
            assertNull(model.state.value.identity)
            assertNull(model.state.value.error)
            assertTrue(server.paths.isEmpty())
            main { model.login(server.origin, "test@example.invalid", "incorrect") }
            await { !model.state.value.authenticating }
            assertEquals("邮箱或密码错误", model.state.value.error)
            assertFalse(model.state.value.restoreFailed)
            main {
                model.logout()
                model.restore()
            }
            await { !model.state.value.restoring }
            assertNull(model.state.value.error)
        }
    }

    @Test
    fun filterDraftAndBatchTagSelectionSurviveRecreation() {
        Server().use { server ->
            val model = model(server)
            val restore = StateRestorationTester(compose)
            val snapshot = model.state.value
            var panel by androidx.compose.runtime.mutableStateOf("筛选")
            restore.setContent {
                NativeTheme {
                    androidx.compose.material3.Surface {
                        NativeFilterSheet(
                            snapshot.copy(
                                filterPanel = panel,
                                options =
                                    NativeOptions(
                                        tags = listOf(NativeTag("tag", "保留标签")),
                                        formats = listOf("png"),
                                    ),
                            ),
                            model,
                        )
                    }
                }
            }
            compose.onNodeWithText("PNG").performScrollTo().performClick()
            restore.emulateSavedInstanceStateRestore()
            compose.onNodeWithText("PNG").assertIsSelected()
            compose.runOnIdle { panel = "添加标签" }
            compose.onNodeWithText("保留标签").performScrollTo().performClick()
            restore.emulateSavedInstanceStateRestore()
            compose.onNodeWithText("保留标签").assertIsSelected()
            main { model.logout() }
        }
    }
}
