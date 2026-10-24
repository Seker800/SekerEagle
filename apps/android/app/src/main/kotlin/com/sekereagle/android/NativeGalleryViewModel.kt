package com.sekereagle.android

import android.Manifest
import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sekereagle.android.core.BackupPermissionPolicy
import com.sekereagle.android.core.BackupPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

data class NativeIdentity(val scope: String, val email: String, val origin: String)

data class GalleryState(
    val identity: NativeIdentity? = null,
    val restoring: Boolean = true,
    val authenticating: Boolean = false,
    val restoreFailed: Boolean = false,
    val mode: GalleryMode = GalleryMode.PHOTO,
    val sort: GallerySort = GallerySort.CAPTURED_AT,
    val timeline: NativeTimeline? = null,
    val windowOffset: Long = 0,
    val scrollRequest: Int = 0,
    val items: List<NativeAsset> = emptyList(),
    val cursor: String? = null,
    val query: String = "",
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val searchOpen: Boolean = false,
    val searchDraft: String = "",
    val searchFilters: NativeFilters = NativeFilters(),
    val history: List<String> = emptyList(),
    val viewerId: String? = null,
    val accountOpen: Boolean = false,
    val cacheOpen: Boolean = false,
    val transfersOpen: Boolean = false,
    val columns: Int = 3,
    val filters: NativeFilters = NativeFilters(),
    val filterPanel: String? = null,
    val options: NativeOptions = NativeOptions(),
    val optionStatus: Map<NativeOptionSection, NativeOptionStatus> = emptyMap(),
    val selecting: Boolean = false,
    val selected: Set<String> = emptySet(),
    val busy: Boolean = false,
    val message: String? = null,
    val trash: Boolean = false,
) {
    val optionsLoading
        get() = optionStatus.values.any { it.loading }

    val optionsError
        get() = optionStatus.values.mapNotNull { it.error }.joinToString("；").ifEmpty { null }
}

/**
 * Owns the native flow. A cancelled/replaced scope can never publish a response into another one.
 */
class NativeGalleryViewModel(application: Application) : AndroidViewModel(application) {
    private val cityReady =
        viewModelScope.async(Dispatchers.IO) { NativeCity.initialize(application) }

    val mediaCache = NativeMediaCache.get(application)
    private val settings = BackupSettings(application)
    private val mutable = MutableStateFlow(GalleryState())
    val state = mutable.asStateFlow()
    private val retained = MutableStateFlow<Map<GalleryMode, GalleryState>>(emptyMap())
    val retainedLibraries = retained.asStateFlow()
    private val staleLibraries = mutableSetOf<GalleryMode>()
    private var prefetchJob: Job? = null
    private var foreground = true

    private fun initialLibrary(identity: NativeIdentity, mode: GalleryMode) =
        GalleryState(
            identity = identity,
            restoring = false,
            mode = mode,
            sort = GallerySort.restore(settings, identity.scope, mode),
            history = history(identity.scope, mode),
        )

    private fun clearLibraries() {
        cancelOptions()
        prefetchJob?.cancel()
        retained.value = emptyMap()
        staleLibraries.clear()
    }

    private fun invalidateInactiveLibrary() {
        prefetchJob?.cancel()
        staleLibraries.addAll(GalleryMode.entries.filter { it != state.value.mode })
    }

    /** Only the other library's first page; never originals or an entire library. */
    private fun prefetchLibrary() {
        val current = state.value
        val identity = current.identity ?: return
        val repo = repository ?: return
        val mode = GalleryMode.entries.first { it != current.mode }
        if (retained.value.containsKey(mode) || prefetchJob?.isActive == true) return
        val snapshot = initialLibrary(identity, mode)
        prefetchJob = viewModelScope.launch {
            try {
                val page = repo.page(mode, "", sort = snapshot.sort)
                val timeline =
                    try {
                        repo.timeline(mode, snapshot.sort)
                    } catch (reason: CancellationException) {
                        throw reason
                    } catch (reason: Exception) {
                        if (reason is NativeSession.Failure && reason.status == 401) throw reason
                        null
                    }
                if (
                    repository === repo &&
                        state.value.identity == identity &&
                        state.value.mode != mode
                ) {
                    retained.value =
                        retained.value +
                            (mode to
                                snapshot.copy(
                                    items = page.items,
                                    cursor = page.cursor,
                                    timeline = timeline,
                                    loaded = true,
                                ))
                    staleLibraries.remove(mode)
                }
            } catch (reason: CancellationException) {
                throw reason
            } catch (reason: Exception) {
                if (repository === repo && reason is NativeSession.Failure && reason.status == 401)
                    expire()
                // An optional prefetch failure must not replace the visible library.
            }
        }
    }

    private var session: NativeSession? = null
    var repository: NativeGalleryRepository? = null
        private set

    val downloads =
        NativeDownloads(application, viewModelScope) { expired ->
            if (session === expired) expire()
        }

    val transfers = NativeTransferManager.get(application)
    private var uploadPickerTarget: Pair<String, GalleryMode>? = null

    fun prepareUploadSelection(): Boolean {
        val current = state.value
        val identity = current.identity ?: return false
        if (current.busy || current.trash || downloads.state.value != null) return false
        uploadPickerTarget = identity.scope to current.mode
        return true
    }

    fun acceptUploadSelection(uris: List<android.net.Uri>) {
        val target = uploadPickerTarget.also { uploadPickerTarget = null } ?: return
        if (uris.isEmpty()) return
        if (state.value.identity?.scope != target.first || state.value.mode != target.second) {
            mutable.value = state.value.copy(message = "账号或模式已变化，请重新选择上传文件")
            return
        }
        val connection = session ?: return
        val identity = state.value.identity ?: return
        runCatching { transfers.enqueue(connection, identity, target.second, uris) }
            .onSuccess { mutable.value = state.value.copy(message = "已加入传输列表，可继续浏览") }
            .onFailure { mutable.value = state.value.copy(message = it.message ?: "未能加入传输列表，请重试") }
    }

    fun downloadAssets(assets: List<NativeAsset>) {
        val current = state.value
        val connection = session ?: return
        if (current.busy || current.trash || assets.isEmpty()) return
        if (assets.any { candidate -> current.items.none { it.id == candidate.id } }) return
        downloads.start(connection, current.mode, assets.toList())
    }

    fun downloadSelected() {
        val current = state.value
        val assets = current.items.filter { it.id in current.selected }
        if (assets.size == current.selected.size) downloadAssets(assets)
    }

    private var operation: Job? = null
    private var sessionJob: Job? = null
    private var signingOut: Job? = null
    private var foregroundJob: Job? = null
    private var optionsJob: Job? = null
    private var optionsGeneration = 0
    private var optionsCancellation: NativeTransferCancellation? = null
    private var timelineJob: Job? = null
    private var mutation: Job? = null
    private var generation = 0
    private var transferRefreshPending = false

    private fun refreshTransfersWhenIdle() {
        val current = state.value
        if (
            transferRefreshPending &&
                current.viewerId == null &&
                !current.selecting &&
                !current.busy &&
                !current.loading
        ) {
            transferRefreshPending = false
            refresh()
        }
    }

    val serverOrigin: String
        get() = settings.origin()

    init {
        viewModelScope.launch {
            transfers.events.collect { event ->
                if (state.value.identity?.scope == event.scope) {
                    if (event.unauthorized) expire()
                    else {
                        event.message?.let {
                            mutable.value = state.value.copy(message = it)
                        }
                        if (state.value.mode != event.mode) {
                            prefetchJob?.cancel()
                            staleLibraries.add(event.mode)
                        }
                        if (state.value.mode == event.mode) {
                            transferRefreshPending = true
                            refreshTransfersWhenIdle()
                        }
                    }
                }
            }
        }
        restore()
    }

    fun restore() {
        val origin = settings.origin()
        if (
            origin.isEmpty() || settings.value("native-session:$origin", "credential", "").isEmpty()
        ) {
            mutable.value = GalleryState(restoring = false)
            return
        }
        authenticate(origin, null, null)
    }

    fun login(origin: String, email: String, password: String) =
        authenticate(origin, email, password)

    private fun authenticate(origin: String, email: String?, password: String?) {
        downloads.clear()
        clearLibraries()
        if (email != null) {
            transfers.clear()
            mediaCache.invalidate()
            viewModelScope.launch { runCatching { mediaCache.clear() } }
        }
        uploadPickerTarget = null
        sessionJob?.cancel()
        timelineJob?.cancel()
        operation?.cancel()
        val request = ++generation
        repository?.clear()
        repository = null
        if (email != null) {
            getApplication<Application>()
                .stopService(Intent(getApplication(), BackupService::class.java))
            settings.active("")
        }
        mutable.value = GalleryState(restoring = email == null, authenticating = email != null)
        sessionJob = viewModelScope.launch {
            try {
                signingOut?.join()
                val normalized = BackupPolicy.origin(origin, BuildConfig.DEBUG)
                val connection =
                    withContext(Dispatchers.IO) { NativeSession.open(getApplication(), normalized) }
                val result =
                    withContext(Dispatchers.IO) {
                        if (email == null) connection.json("GET", "/api/auth/me")
                        else connection.login(email, password.orEmpty())
                    }
                if (request != generation) return@launch
                val user = result.getJSONObject("user")
                val deployment = result.getJSONObject("desktopCache").getString("deploymentId")
                val owner = user.getString("id")
                val scope = BackupPolicy.digest("$normalized\n$deployment\n$owner")
                withContext(Dispatchers.IO) {
                    if (settings.origin() != normalized) settings.origin(normalized)
                    settings.setValue(scope, "origin", normalized)
                    settings.setValue(scope, "owner", owner)
                    settings.setValue(scope, "deployment", deployment)
                    settings.setValue(scope, "email", user.getString("email"))
                    if (settings.active() != scope)
                        getApplication<Application>()
                            .stopService(Intent(getApplication(), BackupService::class.java))
                    settings.active(scope)
                }
                if (request != generation) return@launch
                cityReady.await()
                if (request != generation) return@launch
                session = connection
                repository = NativeGalleryRepository(connection, scope, mediaCache)
                mutable.value =
                    GalleryState(
                        identity = NativeIdentity(scope, user.getString("email"), normalized),
                        restoring = false,
                        history = history(scope, GalleryMode.PHOTO),
                        sort = GallerySort.restore(settings, scope, GalleryMode.PHOTO),
                    )
                load()
                automaticallyBackup()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (request == generation) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    mutable.value =
                        GalleryState(
                            restoring = false,
                            restoreFailed =
                                email == null && !(e is NativeSession.Failure && e.status == 401),
                            error =
                                if (e is NativeSession.Failure && e.status == 401 && email != null)
                                    "邮箱或密码错误"
                                else e.message ?: "无法连接，请检查网络后重试",
                        )
                }
            }
        }
    }

    fun switchMode(mode: GalleryMode) {
        val current = state.value
        val identity = current.identity ?: return
        if (current.busy || mode == current.mode) return
        if (transferRefreshPending || (current.loading && current.loaded))
            staleLibraries.add(current.mode)
        transferRefreshPending = false
        downloads.clear()
        uploadPickerTarget = null
        operation?.cancel()
        cancelOptions()
        timelineJob?.cancel()
        prefetchJob?.cancel()
        generation++
        // Retain browsing state, never transient actions or dialogs from the old workspace.
        retained.value =
            retained.value +
                (current.mode to
                    current.copy(
                        loading = false,
                        optionStatus =
                            current.optionStatus.mapValues { (_, value) ->
                                value.copy(loading = false)
                            },
                        filterPanel = null,
                        selecting = false,
                        selected = emptySet(),
                        viewerId = null,
                        searchOpen = false,
                        accountOpen = false,
                        cacheOpen = false,
                        transfersOpen = false,
                        message = null,
                    ))
        val restored = retained.value[mode] ?: initialLibrary(identity, mode)
        mutable.value = restored
        if (!restored.loaded) load()
        else if (staleLibraries.remove(mode)) refresh()
        else {
            if (restored.timeline == null) repository?.let { loadTimeline(restored, it) }
            prefetchLibrary()
        }
    }

    fun sort(order: GallerySort) {
        val current = state.value
        val identity = current.identity ?: return
        if (current.busy || current.sort == order) return
        settings.setValue(identity.scope, GallerySort.key(current.mode), order.name)
        operation?.cancel()
        generation++
        mutable.value =
            current.copy(
                sort = order,
                scrollRequest = current.scrollRequest + 1,
                items = emptyList(),
                loaded = false,
                cursor = null,
                selecting = false,
                selected = emptySet(),
                viewerId = null,
                error = null,
            )
        load()
    }

    fun load(next: Boolean = false, before: String? = null, offset: Long = 0) {
        if (state.value.busy) return
        val snapshot = state.value
        val repo = repository ?: return
        if (next && (snapshot.loading || snapshot.cursor == null)) return
        operation?.cancel()
        val request = ++generation
        mutable.value =
            snapshot.copy(
                loading = true,
                error = null,
                windowOffset = if (!next && before == null) 0 else snapshot.windowOffset,
            )
        if (!next) loadTimeline(snapshot, repo)
        operation = viewModelScope.launch {
            try {
                val page =
                    repo.page(
                        snapshot.mode,
                        snapshot.query,
                        if (next) snapshot.cursor else null,
                        snapshot.filters,
                        snapshot.trash,
                        snapshot.sort,
                        before,
                        offset,
                    )
                if (request != generation) return@launch
                mutable.value =
                    state.value.copy(
                        items =
                            (if (next) snapshot.items + page.items else page.items).distinctBy {
                                it.id
                            },
                        cursor = page.cursor,
                        loaded = true,
                        loading = false,
                    )
                refreshTransfersWhenIdle()
                prefetchLibrary()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (request == generation) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    else
                        mutable.value =
                            state.value.copy(loading = false, error = e.message ?: "加载失败，请重试")
                }
            }
        }
    }

    /** Re-read the loaded window atomically so stable item keys retain the visible anchor. */
    fun refresh() {
        val snapshot = state.value
        val repo = repository ?: return
        if (snapshot.busy || snapshot.loading) return
        operation?.cancel()
        val request = ++generation
        transferRefreshPending = false
        mutable.value = snapshot.copy(loading = true, error = null)
        loadTimeline(snapshot, repo)
        operation = viewModelScope.launch {
            try {
                val items = mutableListOf<NativeAsset>()
                var cursor: String? = null
                do {
                    val page =
                        repo.page(
                            snapshot.mode,
                            snapshot.query,
                            cursor,
                            snapshot.filters,
                            snapshot.trash,
                            snapshot.sort,
                            offset =
                                if (
                                    cursor == null &&
                                        snapshot.query.isBlank() &&
                                        !snapshot.filters.active &&
                                        !snapshot.trash
                                )
                                    snapshot.windowOffset
                                else 0,
                        )
                    items.addAll(page.items)
                    cursor = page.cursor
                } while (cursor != null && items.size < maxOf(60, snapshot.items.size))
                if (request != generation) return@launch
                mutable.value =
                    state.value.copy(
                        items = items.distinctBy { it.id },
                        cursor = cursor,
                        selected = state.value.selected.intersect(items.map { it.id }.toSet()),
                        loading = false,
                    )
                refreshTransfersWhenIdle()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (request == generation) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    else
                        mutable.value =
                            state.value.copy(loading = false, error = e.message ?: "刷新失败，请重试")
                }
            }
        }
    }

    fun loadPrevious() {
        val snapshot = state.value
        val repo = repository ?: return
        val index = snapshot.timeline ?: return
        if (
            snapshot.loading ||
                snapshot.busy ||
                snapshot.windowOffset <= 0 ||
                snapshot.query.isNotBlank() ||
                snapshot.filters.active ||
                snapshot.trash
        )
            return
        val start = (snapshot.windowOffset - 60).coerceAtLeast(0)
        val day = index.dayAt(start) ?: return
        val request = ++generation
        mutable.value = snapshot.copy(loading = true, error = null)
        operation = viewModelScope.launch {
            try {
                val page =
                    repo.page(
                        snapshot.mode,
                        "",
                        sort = snapshot.sort,
                        before = day.before,
                        offset = start - day.offset,
                    )
                if (request != generation) return@launch
                mutable.value =
                    state.value.copy(
                        items = (page.items + snapshot.items).distinctBy { it.id },
                        windowOffset = start,
                        loading = false,
                    )
                refreshTransfersWhenIdle()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (request == generation) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    else
                        mutable.value =
                            state.value.copy(loading = false, error = e.message ?: "加载较新照片失败，请重试")
                }
            }
        }
    }

    private fun loadTimeline(snapshot: GalleryState, repo: NativeGalleryRepository) {
        timelineJob?.cancel()
        mutable.value = state.value.copy(timeline = null)
        if (snapshot.query.isNotBlank() || snapshot.filters.active || snapshot.trash) return
        timelineJob = viewModelScope.launch {
            try {
                val timeline = repo.timeline(snapshot.mode, snapshot.sort)
                val current = state.value
                if (
                    current.identity == snapshot.identity &&
                        current.mode == snapshot.mode &&
                        current.sort == snapshot.sort &&
                        current.query.isBlank() &&
                        !current.filters.active &&
                        !current.trash
                )
                    mutable.value = current.copy(timeline = timeline)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                /* Ordinary cursor paging remains available if navigation cannot load. */
            }
        }
    }

    fun jumpToDay(day: NativeDay, ordinal: Long = day.offset) {
        val current = state.value
        if (
            current.busy ||
                current.timeline?.days?.contains(day) != true ||
                current.query.isNotBlank() ||
                current.filters.active ||
                current.trash
        )
            return
        val position = ordinal.coerceIn(day.offset, day.offset + day.count - 1)
        mutable.value =
            current.copy(
                items = emptyList(),
                loaded = false,
                cursor = null,
                windowOffset = position,
                scrollRequest = current.scrollRequest + 1,
                selecting = false,
                selected = emptySet(),
                viewerId = null,
            )
        load(before = day.before, offset = position - day.offset)
    }

    fun search(value: String, filters: NativeFilters = state.value.filters) {
        if (state.value.busy || filters.validationError() != null) return
        cancelOptions()
        val query = value.trim().take(200)
        val current = state.value
        val history =
            if (query.isBlank()) current.history
            else (listOf(query) + current.history).distinct().take(12)
        current.identity?.let {
            settings.setValue(
                it.scope,
                "native-history:${current.mode}",
                JSONArray(history).toString(),
            )
        }
        mutable.value =
            current.copy(
                query = query,
                scrollRequest = current.scrollRequest + 1,
                filters = filters,
                filterPanel = null,
                searchDraft = query,
                searchFilters = filters,
                selecting = false,
                selected = emptySet(),
                history = history,
                searchOpen = false,
                viewerId = null,
                items = emptyList(),
                loaded = false,
                cursor = null,
            )
        load()
    }

    fun clearHistory() {
        state.value.identity?.let {
            settings.setValue(it.scope, "native-history:${state.value.mode}", "[]")
        }
        mutable.value = state.value.copy(history = emptyList())
    }

    fun openSearch() {
        mutable.value =
            state.value.copy(
                searchOpen = true,
                searchDraft = state.value.query,
                searchFilters = state.value.filters,
                accountOpen = false,
            )
    }

    fun updateSearchDraft(value: String) {
        mutable.value = state.value.copy(searchDraft = value.take(200))
    }

    fun removeFilter(key: String) {
        val current = state.value
        if (current.searchOpen)
            mutable.value = current.copy(searchFilters = current.searchFilters.without(key))
        else applyFilters(current.filters.without(key))
    }

    fun confirmFilters(filters: NativeFilters) {
        if (state.value.busy || filters.validationError() != null) return
        cancelOptions()
        if (state.value.searchOpen)
            mutable.value = state.value.copy(searchFilters = filters, filterPanel = null)
        else applyFilters(filters)
    }

    fun clearSearch() {
        search("", NativeFilters())
    }

    fun openTransfers() {
        if (state.value.identity != null)
            mutable.value =
                state.value.copy(
                    transfersOpen = true,
                    cacheOpen = false,
                    accountOpen = false,
                    searchOpen = false,
                    viewerId = null,
                )
    }

    fun openCache() {
        mutable.value =
            state.value.copy(
                cacheOpen = true,
                accountOpen = false,
                transfersOpen = false,
                searchOpen = false,
                viewerId = null,
            )
    }

    fun openAccount() {
        mutable.value =
            state.value.copy(
                accountOpen = true,
                cacheOpen = false,
                transfersOpen = false,
                searchOpen = false,
                viewerId = null,
            )
    }

    fun openAsset(id: String) {
        if (state.value.selecting) {
            toggleSelection(id)
            return
        }
        mutable.value = state.value.copy(viewerId = id, cacheOpen = false)
    }

    fun openSavedAsset(id: String) {
        val identity = state.value.identity
        val mode = state.value.mode
        refresh()
        val refreshWork = operation
        viewModelScope.launch {
            refreshWork?.join()
            if (state.value.identity != identity || state.value.mode != mode) return@launch
            if (state.value.items.any { it.id == id }) openAsset(id)
            else mutable.value = state.value.copy(message = "照片已保存，当前筛选或浏览位置未包含副本，请返回图库查看")
        }
    }

    fun viewerPage(id: String) {
        val current = state.value
        if (current.viewerId != null && current.items.any { it.id == id })
            mutable.value = current.copy(viewerId = id)
    }

    fun columns(value: Int) {
        mutable.value = state.value.copy(columns = value)
    }

    fun back(): Boolean {
        val s = state.value
        mutable.value =
            when {
                s.busy -> return true
                s.cacheOpen -> s.copy(cacheOpen = false)
                s.transfersOpen -> s.copy(transfersOpen = false)
                s.filterPanel != null -> {
                    closePanel()
                    return true
                }
                s.selecting -> s.copy(selecting = false, selected = emptySet())
                s.viewerId != null -> s.copy(viewerId = null)
                s.searchOpen ->
                    s.copy(searchOpen = false, searchDraft = s.query, searchFilters = s.filters)
                s.accountOpen -> s.copy(accountOpen = false)
                s.trash -> {
                    openTrash(false)
                    return true
                }
                s.filters.active || s.query.isNotEmpty() -> {
                    clearSearch()
                    return true
                }
                else -> return false
            }
        refreshTransfersWhenIdle()
        return true
    }

    private fun cancelOptions() {
        optionsCancellation?.cancel()
        optionsCancellation = null
        optionsJob?.cancel()
        optionsGeneration++
        if (state.value.optionsLoading)
            mutable.value =
                state.value.copy(
                    optionStatus =
                        state.value.optionStatus.mapValues { (_, value) ->
                            value.copy(loading = false)
                        }
                )
    }

    fun openFilters(panel: String) {
        val repo = repository ?: return
        val current = state.value
        if (current.busy) return
        val sections =
            when (panel) {
                "标签",
                "添加标签",
                "移除标签" -> setOf(NativeOptionSection.TAGS)
                "格式" -> setOf(NativeOptionSection.FORMATS)
                "相机",
                "镜头" -> setOf(NativeOptionSection.PHOTOGRAPHY)
                "筛选" ->
                    NativeOptionSection.entries
                        .filter {
                            it != NativeOptionSection.PHOTOGRAPHY ||
                                current.mode == GalleryMode.PHOTO
                        }
                        .toSet()
                else -> emptySet()
            }
        cancelOptions()
        val request = optionsGeneration
        val cancellation = NativeTransferCancellation().also { optionsCancellation = it }
        mutable.value =
            current.copy(
                filterPanel = panel,
                message = null,
                optionStatus =
                    current.optionStatus.mapValues { (_, v) -> v.copy(loading = false) } +
                        sections.associateWith { NativeOptionStatus(loading = true) },
            )
        optionsJob = viewModelScope.launch {
            sections.forEach { section ->
                launch {
                    try {
                        val options = repo.options(current.mode, section, cancellation)
                        if (
                            optionsGeneration == request &&
                                state.value.identity == current.identity &&
                                state.value.mode == current.mode
                        )
                            mutable.value =
                                state.value.copy(
                                    options = state.value.options.merge(section, options),
                                    optionStatus =
                                        state.value.optionStatus +
                                            (section to NativeOptionStatus()),
                                )
                    } catch (reason: CancellationException) {
                        throw reason
                    } catch (reason: Exception) {
                        if (
                            optionsGeneration == request &&
                                state.value.identity == current.identity &&
                                state.value.mode == current.mode
                        ) {
                            if (reason is NativeSession.Failure && reason.status == 401) expire()
                            else
                                mutable.value =
                                    state.value.copy(
                                        optionStatus =
                                            state.value.optionStatus +
                                                (section to
                                                    NativeOptionStatus(
                                                        error = reason.message ?: "无法读取选项"
                                                    ))
                                    )
                        }
                    }
                }
            }
        }
    }

    fun closePanel() {
        if (state.value.busy) return
        cancelOptions()
        mutable.value = state.value.copy(filterPanel = null)
    }

    fun applyFilters(filters: NativeFilters) {
        if (state.value.busy || filters.validationError() != null) return
        mutable.value =
            state.value.copy(
                filters = filters,
                scrollRequest = state.value.scrollRequest + 1,
                filterPanel = null,
                items = emptyList(),
                loaded = false,
                cursor = null,
                selecting = false,
                selected = emptySet(),
                viewerId = null,
            )
        load()
    }

    fun openTrash(value: Boolean = true) {
        if (state.value.busy) return
        mutable.value =
            state.value.copy(
                trash = value,
                scrollRequest = state.value.scrollRequest + 1,
                filters = NativeFilters(),
                query = "",
                items = emptyList(),
                loaded = false,
                cursor = null,
                viewerId = null,
                accountOpen = false,
                selecting = false,
                selected = emptySet(),
            )
        load()
    }

    fun startSelection(id: String) {
        if (state.value.busy) return
        mutable.value = state.value.copy(selecting = true, message = null)
        toggleSelection(id)
    }

    fun toggleSelection(id: String) {
        val s = state.value
        if (s.busy) return
        val selected = NativeSelection.toggle(s.selected, id, s.items.map { it.id }.toSet())
        mutable.value =
            s.copy(
                selected = selected,
                message = if (selected == s.selected && id !in s.selected) "每次最多选择 100 项" else null,
            )
    }

    fun selectLoaded(ids: Set<String> = state.value.items.map { it.id }.toSet()) {
        val s = state.value
        if (s.busy) return
        val available = s.items.map { it.id }.toSet().intersect(ids)
        val allSelected = available.isNotEmpty() && available.all { it in s.selected }
        mutable.value =
            s.copy(
                selected =
                    if (allSelected) s.selected - available
                    else NativeSelection.all(s.selected + available),
                message =
                    if (!allSelected && (s.selected + available).size > NativeSelection.LIMIT)
                        "每次最多选择 100 项，超出部分未选择"
                    else null,
            )
    }

    fun changeSelection(action: String, tags: Set<String> = emptySet(), rating: Int? = null) {
        val s = state.value
        if (s.busy || s.selected.isEmpty()) return
        val repo = repository ?: return
        val assets = s.items.filter { it.id in s.selected }
        if (assets.size != s.selected.size) return
        operation?.cancel()
        val request = ++generation
        mutable.value = s.copy(busy = true, loading = false, message = null)
        mutation = viewModelScope.launch {
            try {
                repo.change(s.mode, assets, action, tags, rating)
                if (generation != request) return@launch
                invalidateInactiveLibrary()
                mutable.value =
                    state.value.copy(
                        busy = false,
                        selecting = false,
                        selected = emptySet(),
                        filterPanel = null,
                        viewerId = null,
                        message = "已完成，共 ${assets.size} 项",
                    )
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == request) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    else
                        mutable.value =
                            state.value.copy(
                                busy = false,
                                message =
                                    if (e is NativeSession.Failure && e.status == 409)
                                        "内容已被其他操作更新，请刷新后重试"
                                    else "操作未确认完成，请刷新核对后重试：${e.message.orEmpty()}",
                            )
                }
            }
        }
    }

    fun dismissMessage() {
        mutable.value = state.value.copy(message = null)
    }

    fun logout() {
        operation?.cancel()
        sessionJob?.cancel()
        generation++
        val old = session
        old?.invalidateLocally()
        expire()
        signingOut = viewModelScope.launch(Dispatchers.IO) { runCatching { old?.logout() } }
    }

    private fun expire() {
        clearLibraries()
        timelineJob?.cancel()
        foregroundJob?.cancel()
        mediaCache.invalidate()
        viewModelScope.launch { runCatching { mediaCache.clear() } }
        transferRefreshPending = false
        downloads.clear()
        transfers.clear()
        uploadPickerTarget = null
        operation?.cancel()
        generation++
        settings.active("")
        getApplication<Application>()
            .stopService(Intent(getApplication(), BackupService::class.java))
        mutation?.cancel()
        repository?.clear()
        repository = null
        session = null
        // The legacy WebView host is retained only for migration; its unencrypted cookie jar must
        // not outlive a native logout/session expiry.
        runCatching { LegacyWebSession.clear() }
        mutable.value = GalleryState(restoring = false)
    }

    fun onForeground(recreated: Boolean = false) {
        // Cold authentication validates once. A real return or recreated Activity validates again,
        // including brief transitions, while keeping the loaded window and its visible anchor.
        if (foreground && !recreated) return
        foreground = true
        val identity = state.value.identity ?: return
        val connection = session ?: return
        if (foregroundJob?.isActive == true) return
        foregroundJob = viewModelScope.launch {
            try {
                val me = withContext(Dispatchers.IO) { connection.json("GET", "/api/auth/me") }
                if (session !== connection || state.value.identity != identity) return@launch
                val scope =
                    BackupPolicy.digest(
                        "${identity.origin}\n${me.getJSONObject("desktopCache").getString("deploymentId")}\n${me.getJSONObject("user").getString("id")}"
                    )
                if (scope != identity.scope) {
                    connection.invalidateLocally()
                    expire()
                } else {
                    invalidateInactiveLibrary()
                    automaticallyBackup()
                    val current = state.value
                    if (
                        !current.loading &&
                            !current.busy &&
                            !current.selecting &&
                            current.viewerId == null &&
                            !current.searchOpen &&
                            current.filterPanel == null &&
                            downloads.state.value?.running != true &&
                            !transfers.state.value.busy
                    )
                        refresh()
                }
            } catch (reason: CancellationException) {
                throw reason
            } catch (reason: Exception) {
                if (
                    session === connection &&
                        reason is NativeSession.Failure &&
                        reason.status == 401
                )
                    expire()
            }
        }
    }

    fun onBackground() {
        foreground = false
        downloads.cancel()
    }

    fun backupNeedsMediaPermission(scope: String = state.value.identity?.scope.orEmpty()): Boolean {
        if (scope.isEmpty()) return false
        val rules = runCatching { settings.scanRules(scope) }.getOrNull() ?: return false
        val count =
            (0 until rules.length()).count {
                rules.optJSONObject(it)?.optString("type") == "media"
            }
        return BackupPermissionPolicy.requiresCompleteMediaAccess(count)
    }

    fun mediaPermissionGranted(): Boolean {
        val context = getApplication<Application>()
        val images =
            Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
                    PackageManager.PERMISSION_GRANTED
        val video =
            Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
                    PackageManager.PERMISSION_GRANTED
        val storage =
            Build.VERSION.SDK_INT < 33 &&
                context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
        return BackupPermissionPolicy.hasCompleteMediaAccess(
            Build.VERSION.SDK_INT,
            images,
            video,
            storage,
        )
    }

    fun mediaPermissionNames(): Array<String> =
        if (Build.VERSION.SDK_INT >= 33)
            arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)

    private fun automaticallyBackup() {
        val identity = state.value.identity ?: return
        if (
            settings.active() != identity.scope ||
                !settings.flag(identity.scope, "enabled", false) ||
                !settings.flag(identity.scope, "auto", false)
        )
            return
        // Partial photo grants are not a complete directory scan; wait for explicit consent
        // instead of silently backing up only the selected subset.
        if (backupNeedsMediaPermission(identity.scope) && !mediaPermissionGranted()) {
            settings.setValue(identity.scope, "status", "等待完整的照片和视频访问权限")
            return
        }
        runCatching {
            getApplication<Application>()
                .startForegroundService(
                    Intent(getApplication(), BackupService::class.java)
                        .putExtra("scope", identity.scope)
                )
        }
    }

    private fun history(scope: String, mode: GalleryMode): List<String> =
        runCatching {
                val values = JSONArray(settings.value(scope, "native-history:$mode", "[]"))
                (0 until minOf(12, values.length())).mapNotNull {
                    values.optString(it).takeIf { q -> q.isNotBlank() && q.length <= 200 }
                }
            }
            .getOrDefault(emptyList())

    override fun onCleared() {
        cancelOptions()
        downloads.clear()
        uploadPickerTarget = null
        repository?.clear()
    }
}
