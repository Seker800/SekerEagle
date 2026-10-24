package com.sekereagle.android

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/** App-private metadata only. Cookies remain in NativeSession/Keystore. */
internal class NativeTransferStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("native-transfer-queue", Context.MODE_PRIVATE)

    fun save(batches: List<NativeTransferBatch>) {
        val rows =
            JSONArray(
                batches.map { batch ->
                    JSONObject()
                        .put("id", batch.id)
                        .put("scope", batch.scope)
                        .put("origin", batch.origin)
                        .put("mode", batch.mode.name)
                        .put("waiting", batch.waiting)
                        .put("paused", batch.paused)
                        .put(
                            "entries",
                            JSONArray(
                                batch.entries.map { entry ->
                                    JSONObject()
                                        .put("uri", entry.uri.toString())
                                        .put("name", entry.name)
                                        .put("size", entry.size)
                                }
                            ),
                        )
                        .put("uploaded", batch.progress?.uploaded ?: 0)
                        .put("skipped", batch.progress?.skipped ?: 0)
                        .put(
                            "done",
                            JSONArray(
                                batch.progress?.completedEntries.orEmpty().map { it.toString() }
                            ),
                        )
                        .put(
                            "issues",
                            JSONArray(
                                batch.progress?.issues.orEmpty().map { issue ->
                                    JSONObject()
                                        .put("uri", issue.entry.uri.toString())
                                        .put("reason", issue.reason)
                                }
                            ),
                        )
                        .put("message", batch.message)
                }
            )
        check(preferences.edit().putString("queue", rows.toString()).commit()) { "无法保存传输列表" }
    }

    fun load(): List<NativeTransferBatch> {
        val rows =
            runCatching { JSONArray(preferences.getString("queue", "[]")) }.getOrNull()
                ?: return emptyList()
        // Recover independently: one corrupt row must not discard every other durable batch.
        return (0 until minOf(rows.length(), 20)).mapNotNull { index ->
            runCatching { parse(rows.getJSONObject(index)) }.getOrNull()
        }
    }

    private fun parse(row: JSONObject): NativeTransferBatch {
        val id = row.getString("id").also { require(it.matches(Regex("[a-f0-9-]{36}"))) }
        val scope = row.getString("scope").also { require(it.matches(Regex("[a-f0-9]{64}"))) }
        val origin =
            com.sekereagle.android.core.BackupPolicy.origin(
                row.getString("origin"),
                BuildConfig.DEBUG,
            )
        val mode = GalleryMode.valueOf(row.getString("mode"))
        val raw = row.getJSONArray("entries")
        require(raw.length() in 1..100)
        val entries =
            (0 until raw.length()).map { i ->
                raw.getJSONObject(i).let {
                    NativeUploadEntry(
                        Uri.parse(it.getString("uri")),
                        it.getString("name"),
                        it.getLong("size"),
                    )
                }
            }
        com.sekereagle.android.core.NativeUploadPolicy.picked(entries.map { it.uri.toString() })
        val doneRaw = row.getJSONArray("done")
        val done =
            (0 until doneRaw.length())
                .map { Uri.parse(doneRaw.getString(it)) }
                .toSet()
                .intersect(entries.map { it.uri }.toSet())
        val issuesRaw = row.getJSONArray("issues")
        val issues =
            (0 until issuesRaw.length()).mapNotNull { i ->
                issuesRaw.getJSONObject(i).let { issue ->
                    entries
                        .firstOrNull { it.uri.toString() == issue.getString("uri") }
                        ?.let { NativeUploadIssue(it, issue.getString("reason")) }
                }
            }
        return NativeTransferBatch(
            id,
            scope,
            origin,
            mode,
            entries,
            waiting = false,
            paused = done.size < entries.size,
            progress =
                NativeUploadState(
                    mode,
                    NativeUploadPhase.FINISHED,
                    entries,
                    uploaded = row.optInt("uploaded"),
                    skipped = row.optInt("skipped"),
                    completedEntries = done,
                    issues = issues,
                    remaining =
                        entries.filter {
                            it.uri !in done &&
                                issues.none { issue -> issue.entry.uri == it.uri }
                        },
                    cancelled = done.size < entries.size,
                ),
            message =
                if (done.size < entries.size) "上次传输已中断，点击继续；将重新核对文件和服务器副本"
                else row.optString("message"),
        )
    }
}
