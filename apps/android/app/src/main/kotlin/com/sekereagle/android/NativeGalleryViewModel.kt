package com.sekereagle.android

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sekereagle.android.core.BackupPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    val mode: GalleryMode = GalleryMode.PHOTO,
    val items: List<NativeAsset> = emptyList(),
    val cursor: String? = null,
    val query: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val searchOpen: Boolean = false,
    val history: List<String> = emptyList(),
    val viewerId: String? = null,
    val moreOpen: Boolean = false,
    val columns: Int = 3,
)

/**
 * Owns the native flow. A cancelled/replaced scope can never publish a response into another one.
 */
class NativeGalleryViewModel(application: Application) : AndroidViewModel(application) {
    private val settings = BackupSettings(application)
    private val mutable = MutableStateFlow(GalleryState())
    val state = mutable.asStateFlow()
    private var session: NativeSession? = null
    var repository: NativeGalleryRepository? = null
        private set

    private var operation: Job? = null
    private var sessionJob: Job? = null
    private var signingOut: Job? = null
    private var foregroundJob: Job? = null
    private var generation = 0
    val serverOrigin: String
        get() = settings.origin()

    init {
        restore()
    }

    fun restore() {
        val origin = settings.origin()
        if (origin.isEmpty()) {
            mutable.value = GalleryState(restoring = false)
            return
        }
        authenticate(origin, null, null)
    }

    fun login(origin: String, email: String, password: String) =
        authenticate(origin, email, password)

    private fun authenticate(origin: String, email: String?, password: String?) {
        sessionJob?.cancel()
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
                val connection = NativeSession.open(getApplication(), normalized)
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
                session = connection
                repository = NativeGalleryRepository(connection, scope)
                mutable.value =
                    GalleryState(
                        identity = NativeIdentity(scope, user.getString("email"), normalized),
                        restoring = false,
                        history = history(scope, GalleryMode.PHOTO),
                    )
                load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (request == generation) {
                    if (e is NativeSession.Failure && e.status == 401) expire()
                    mutable.value =
                        GalleryState(restoring = false, error = e.message ?: "无法连接，请检查网络后重试")
                }
            }
        }
    }

    fun switchMode(mode: GalleryMode) {
        if (mode == state.value.mode) return
        operation?.cancel()
        generation++
        val current = state.value
        mutable.value =
            current.copy(
                mode = mode,
                items = emptyList(),
                cursor = null,
                query = "",
                viewerId = null,
                searchOpen = false,
                moreOpen = false,
                error = null,
                history = history(current.identity!!.scope, mode),
            )
        load()
    }

    fun load(next: Boolean = false) {
        val snapshot = state.value
        val repo = repository ?: return
        if (next && (snapshot.loading || snapshot.cursor == null)) return
        operation?.cancel()
        val request = ++generation
        mutable.value = snapshot.copy(loading = true, error = null)
        operation = viewModelScope.launch {
            try {
                val page =
                    repo.page(snapshot.mode, snapshot.query, if (next) snapshot.cursor else null)
                if (request != generation) return@launch
                mutable.value =
                    state.value.copy(
                        items =
                            (if (next) snapshot.items + page.items else page.items).distinctBy {
                                it.id
                            },
                        cursor = page.cursor,
                        loading = false,
                    )
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

    fun search(value: String) {
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
                history = history,
                searchOpen = false,
                viewerId = null,
                items = emptyList(),
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
        mutable.value = state.value.copy(searchOpen = true, moreOpen = false)
    }

    fun openMore() {
        mutable.value = state.value.copy(moreOpen = true)
    }

    fun openAsset(id: String) {
        mutable.value = state.value.copy(viewerId = id)
    }

    fun viewerPage(id: String) {
        mutable.value = state.value.copy(viewerId = id)
    }

    fun columns(value: Int) {
        mutable.value = state.value.copy(columns = value)
    }

    fun back(): Boolean {
        val s = state.value
        mutable.value =
            when {
                s.viewerId != null -> s.copy(viewerId = null)
                s.searchOpen -> s.copy(searchOpen = false)
                s.moreOpen -> s.copy(moreOpen = false)
                s.query.isNotEmpty() -> {
                    search("")
                    return true
                }
                else -> return false
            }
        return true
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
        operation?.cancel()
        generation++
        settings.active("")
        getApplication<Application>()
            .stopService(Intent(getApplication(), BackupService::class.java))
        repository?.clear()
        repository = null
        session = null
        mutable.value = GalleryState(restoring = false)
    }

    fun onForeground() {
        val identity = state.value.identity ?: return
        val connection = session ?: return
        foregroundJob?.cancel()
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
                } else automaticallyBackup()
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

    private fun automaticallyBackup() {
        val identity = state.value.identity ?: return
        if (
            settings.active() != identity.scope ||
                !settings.flag(identity.scope, "enabled", false) ||
                !settings.flag(identity.scope, "auto", false)
        )
            return
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
        repository?.clear()
    }
}
