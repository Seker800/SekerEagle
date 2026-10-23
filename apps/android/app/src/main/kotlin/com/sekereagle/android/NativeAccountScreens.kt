package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun NativeLogin(state: GalleryState, model: NativeGalleryViewModel) {
    var origin by rememberSaveable { mutableStateOf(model.serverOrigin) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    fun submit() {
        val secret = password
        password = ""
        keyboard?.hide()
        model.login(origin, email, secret)
    }
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Outlined.PhotoLibrary, null, Modifier.size(42.dp), tint = Color.White)
        Spacer(Modifier.height(24.dp))
        Text("你的照片，\n随时在手边。", fontSize = 30.sp, lineHeight = 40.sp)
        Spacer(Modifier.height(12.dp))
        Text("连接 SekerEagle 图库", color = NativeMuted)
        Spacer(Modifier.height(32.dp))
        if (state.restoring) {
            CircularProgressIndicator()
            Text("正在连接图库", Modifier.padding(top = 16.dp), color = NativeMuted)
        } else {
            OutlinedTextField(
                origin,
                { origin = it },
                label = { Text("服务器地址") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("native-origin"),
                shape = RoundedCornerShape(20.dp),
                keyboardOptions =
                    KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                email,
                { email = it },
                label = { Text("邮箱") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("native-email"),
                shape = RoundedCornerShape(20.dp),
                keyboardOptions =
                    KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                password,
                { password = it },
                label = { Text("密码") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("native-password"),
                shape = RoundedCornerShape(20.dp),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions =
                    KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (!state.authenticating) submit() }),
            )
            Spacer(Modifier.height(24.dp))
            Button(
                ::submit,
                Modifier.fillMaxWidth().height(52.dp).testTag("native-login"),
                enabled =
                    !state.authenticating &&
                        origin.isNotBlank() &&
                        email.isNotBlank() &&
                        password.isNotEmpty(),
            ) {
                if (state.authenticating)
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("登录")
            }
            state.error?.let {
                Text(
                    it,
                    Modifier.padding(top = 16.dp).testTag("native-error"),
                    color = MaterialTheme.colorScheme.error,
                )
                if (state.restoreFailed) TextButton(model::restore) { Text("重试连接") }
            }
        }
    }
}

@Composable
fun NativeMore(
    identity: NativeIdentity,
    model: NativeGalleryViewModel,
    openNative: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Color.Black).testTag("native-more")) {
        IconButton({ model.back() }, Modifier.padding(8.dp)) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回")
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text(identity.email, fontSize = 21.sp)
            Text(
                "当前原生版仅显示公开图库；私密内容请在网页解锁查看。",
                color = NativeMuted,
                modifier = Modifier.padding(top = 12.dp),
            )
            Text(
                identity.origin,
                Modifier.padding(top = 8.dp, bottom = 28.dp),
                color = NativeMuted,
                fontSize = 13.sp,
            )
            GlassSurface(Modifier.fillMaxWidth(), radius = 24) {
                Column {
                    MenuRow("传输列表", Icons.Outlined.SyncAlt, model::openTransfers)
                    MenuRow("备份设置", Icons.Outlined.CloudUpload) { openNative("backup") }
                    MenuRow("释放手机空间", Icons.Outlined.CleaningServices) { openNative("cleanup") }
                    MenuRow("退出登录", Icons.AutoMirrored.Outlined.Logout, model::logout)
                }
            }
        }
    }
}
