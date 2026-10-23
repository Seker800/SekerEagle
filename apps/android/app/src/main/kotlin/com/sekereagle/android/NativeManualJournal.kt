package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.BackupEngine
import com.sekereagle.android.core.NativeUploadPolicy

/** Same SQLite/checkpoint implementation; a manual batch never creates a cleanup receipt. */
internal class NativeManualJournal(context: Context, scope: String, id: String) : NativeUploadPolicy.ManualStore, AutoCloseable {
    private val delegate = BackupJournal(context)
    private val namespace = "manual:$scope:$id"
    private fun key(value: String) = "$namespace:$value"
    override fun load(key: String): BackupEngine.Checkpoint? = delegate.load(key(key))
    override fun save(key: String, value: BackupEngine.Checkpoint) = delegate.save(key(key), value)
    override fun contains(content: String): Boolean = delegate.contains(key(content))
    override fun confirm(key: String, content: String, value: BackupEngine.Checkpoint) = delegate.confirm(key(key), key(content), value)
    override fun verifyContent(key: String, hash: String) {
        val old = load(key)
        if (old != null && old.hash != hash) save(key, BackupEngine.Checkpoint())
    }
    override fun retryFailures() = delegate.retryFailures(namespace)
    override fun close() = delegate.close()
}
