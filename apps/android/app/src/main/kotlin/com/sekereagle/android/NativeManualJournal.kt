package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.BackupEngine
import com.sekereagle.android.core.NativeUploadPolicy

/** Same SQLite/checkpoint implementation; a manual batch never creates a cleanup receipt. */
internal class NativeManualJournal(context: Context, scope: String, id: String) : NativeUploadPolicy.ManualStore, AutoCloseable {
    private val delegate = BackupJournal(context)
    private val namespace = "manual:$scope:$id"
    private fun key(value: String) = "$namespace:$value"
    override fun load(key: String): BackupEngine.Checkpoint? = delegate.load(key(key))?.apply {
        // Completion is tracked by the task list. A replay after process death must recheck
        // the server, since its copy could have been removed while this app was stopped.
        if (confirmed) { confirmed = false; session = ""; partSize = 0 }
    }
    override fun save(key: String, value: BackupEngine.Checkpoint) = delegate.save(key(key), value)
    override fun contains(content: String): Boolean = false
    override fun confirm(key: String, content: String, value: BackupEngine.Checkpoint) = delegate.save(key(key), value)
    override fun verifyContent(key: String, hash: String) {
        val old = load(key)
        if (old != null && old.hash != hash) save(key, BackupEngine.Checkpoint())
    }
    override fun retryFailures() = delegate.retryFailures(namespace)
    override fun close() = delegate.close()
}
