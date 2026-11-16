package app.suraksha.child

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val vm: ChildViewModel by viewModels()
    private var pendingScreenSession: SessionState? = null
    private var pendingRuntimeSession: SessionState? = null

    private val projectionLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val session = pendingScreenSession
        pendingScreenSession = null
        if (session == null) return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            vm.approve(session, result.data)
        } else {
            vm.note("Screen sharing was not approved in Android. Nothing was shared.")
        }
    }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val session = pendingRuntimeSession
        pendingRuntimeSession = null
        if (session == null) return@registerForActivityResult
        val required = if (session.kind == "audio") Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA
        val allowed = ContextCompat.checkSelfPermission(this, required) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (allowed) vm.approve(session) else vm.note("Android permission was not granted, so the request was left unanswered.")
    }

    private val screenCapture: (SessionState) -> Unit = { session ->
        pendingScreenSession = session
        val manager = getSystemService(MediaProjectionManager::class.java)
        projectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    private val acceptSession: (SessionState) -> Unit = { session ->
        when (session.kind) {
            "screen" -> screenCapture(session)
            "audio" -> {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    vm.approve(session)
                } else {
                    pendingRuntimeSession = session
                    permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                }
            }
            else -> {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    vm.approve(session)
                } else {
                    pendingRuntimeSession = session
                    permissionLauncher.launch(
                        arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
                    )
                }
            }
        }
    }

    private val requestPermissionGroup: (String) -> Unit = { key ->
        when (key) {
            "camera", "microphone", "location" -> {
                val permissions = when (key) {
                    "camera" -> arrayOf(Manifest.permission.CAMERA)
                    "microphone" -> arrayOf(Manifest.permission.RECORD_AUDIO)
                    else -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                }
                permissionLauncher.launch(permissions)
            }
            "notifications" -> if (Build.VERSION.SDK_INT >= 33) {
                permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }
            "usage_access" -> startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            "battery_optimization" -> {
                @Suppress("BATTERY_LIFE")
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            }
            "screen_capture" -> vm.note("Screen capture is requested by Android only while a screen session is approved.")
            else -> vm.note("This optional capability is not used by the current build.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 90)
        }
        setContent {
            val state by vm.state.collectAsState()
            val active by SessionService.active.collectAsState()
            val savedServer = SecureStore.serverUrl(this)
            SurakshaTheme {
                ChildApp(
                    state = state,
                    active = active,
                    serverUrl = savedServer,
                    onPair = vm::pair,
                    onApprove = acceptSession,
                    onDeny = vm::deny,
                    onStopActive = vm::stopActiveSession,
                    onSos = vm::sendSos,
                    onShareLocation = vm::reportLocationNow,
                    onRefresh = vm::sync,
                    onPermissionAction = requestPermissionGroup,
                    onTrustedAccess = vm::setTrustedAccess,
                    onSaveServer = vm::saveServer,
                    onUnlink = vm::unlink,
                )
            }
            androidx.compose.runtime.LaunchedEffect(state.message) {
                state.message?.let {
                    Toast.makeText(this@MainActivity, it, Toast.LENGTH_SHORT).show()
                    vm.consumeMessage()
                }
            }
            androidx.compose.runtime.LaunchedEffect(state.error) {
                state.error?.let {
                    Toast.makeText(this@MainActivity, it, Toast.LENGTH_LONG).show()
                    vm.consumeMessage()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.reportLocationNow()
        if (vm.state.value.linked) vm.sync()
    }
}
