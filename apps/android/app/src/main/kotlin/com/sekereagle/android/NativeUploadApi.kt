package com.sekereagle.android

import com.sekereagle.android.core.BackupEngine
import java.io.FilterInputStream
import java.io.InputStream
import org.json.JSONObject

/** Native cookies stay on API calls; signed part writes reuse the validated backup transport. */
internal class NativeUploadApi(
    private val session: NativeSession,
    private val epoch: Int,
    private val stage: (String) -> Unit,
    private val progress: (Long) -> Unit,
) : UploadApi {
    private val signedParts = ApiClient(session.origin, "")
    private var transferred = 0L

    override fun request(method: String, path: String, body: JSONObject?): JSONObject {
        if (path.endsWith("/check-content")) stage("检查重复文件")
        if (path.endsWith("/complete")) stage("服务器确认入库")
        try {
            return session.jsonAtEpoch(epoch, method, path, body)
        } catch (error: NativeSession.Failure) {
            throw ApiClient.Failure(error.status)
        }
    }

    override fun put(
        url: String,
        input: InputStream,
        bytes: Long,
        guard: BackupEngine.Guard,
    ): String {
        fun check() {
            try {
                session.checkAuthorization(epoch)
            } catch (reason: NativeSession.Failure) {
                throw ApiClient.Failure(reason.status)
            }
            guard.check()
        }
        check()
        stage("上传原文件")
        val observed =
            object : FilterInputStream(input) {
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    check()
                    val count = input.read(buffer, offset, length)
                    if (count > 0) {
                        transferred += count
                        progress(transferred)
                    }
                    return count
                }
            }
        return signedParts.put(url, observed, bytes, ::check)
    }
}
