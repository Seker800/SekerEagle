package com.sekereagle.android

import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class NativeCredentialTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun failedCredentialCommitIsNotReportedAsSuccess() {
        val real = context.getSharedPreferences("credential-failure-test", 0)
        val preferences = Proxy.newProxyInstance(SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java)) { _, method, args ->
            if (method.name == "edit") {
                val editor = real.edit()
                lateinit var proxy: Any
                proxy = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader,
                    arrayOf(SharedPreferences.Editor::class.java)) { _, editMethod, editArgs ->
                    when (editMethod.name) {
                        "commit" -> false
                        else -> {
                            val result = editMethod.invoke(editor, *(editArgs ?: emptyArray()))
                            if (result is SharedPreferences.Editor) proxy else result
                        }
                    }
                }
                proxy
            } else method.invoke(real, *(args ?: emptyArray()))
        } as SharedPreferences
        assertThrows(IllegalStateException::class.java) {
            BackupSettings(preferences).setValue("scope", "credential", "encrypted")
        }
    }

    @Test fun erasureDestroysOnlyTheScopedKeyEvenWhenTheOldCiphertextSurvives() {
        val settings = BackupSettings(context)
        val scope = "credential-erasure-test"
        val other = "credential-other-test"
        settings.saveToken(scope, "old-proof")
        settings.saveToken(other, "other-proof")
        val ciphertext = settings.value(scope, "credential", "")
        settings.clearToken(scope)
        settings.setValue(scope, "credential", ciphertext)
        assertThrows(Exception::class.java) { BackupSettings(context).token(scope) }
        assertEquals("other-proof", settings.token(other))
        settings.clearToken(scope)
        settings.clearToken(other)
    }
}
