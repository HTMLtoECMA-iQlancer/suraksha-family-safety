package app.suraksha.child

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.webrtc.PeerConnection

/**
 * Every approved camera, microphone or screen session runs in a foreground service with
 * a persistent, non-dismissible notification. The notification cannot be hidden and has
 * a Stop action, so the child always sees what is shared and can end it immediately.
 */
class SessionService : Service() {
    data class Active(val sessionId: String, val kind: String, val state: String = "connecting")

    companion object {
        val active = MutableStateFlow<Active?>(null)
        const val ACTION_START = "app.suraksha.child.START_SESSION"
        const val ACTION_STOP = "app.suraksha.child.STOP_SESSION"
        private const val CHANNEL = "active_sessions"
        private const val NOTIFICATION_ID = 4102

        fun startIntent(
            context: Context,
            sessionId: String,
            kind: String,
            projectionData: Intent? = null,
        ): Intent = Intent(context, SessionService::class.java).apply {
            action = ACTION_START
            putExtra("sessionId", sessionId)
            putExtra("kind", kind)
            if (projectionData != null) putExtra("projection", projectionData)
        }

        fun stopIntent(context: Context): Intent =
            Intent(context, SessionService::class.java).apply { action = ACTION_STOP }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var rtc: RtcClient? = null
    private var realtime: Realtime? = null
    private var api: Api? = null
    private var sessionId: String? = null
    private var ending = false
    private var kind: String = "camera"
    private var currentState: String = "connecting"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        api = Api(applicationContext)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> begin(intent)
            ACTION_STOP -> stopByChild()
            else -> stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun begin(intent: Intent) {
        val id = intent.getStringExtra("sessionId") ?: run { stopSelf(); return }
        val sessionKind = intent.getStringExtra("kind") ?: "camera"
        if (sessionId == id) return
        ending = false
        sessionId = id
        kind = sessionKind
        active.value = Active(id, sessionKind)
        val canUseMic = androidx.core.content.ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val type = when (sessionKind) {
            "screen" -> if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
            "audio" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            else -> if (canUseMic) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Connecting to your parent…"), type)

        val projection = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra("projection", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra("projection")
        }

        scope.launch {
            val config = runCatching { api!!.config() }.getOrDefault(ServerConfig(emptyList(), null, null))
            if (sessionId != id) return@launch
            val ice = buildList {
                add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
                if (config.turnUrls.isNotEmpty() && config.turnUsername != null && config.turnCredential != null) {
                    add(
                        PeerConnection.IceServer.builder(config.turnUrls)
                            .setUsername(config.turnUsername)
                            .setPassword(config.turnCredential)
                            .createIceServer(),
                    )
                }
            }
            val socket = Realtime(
                scope,
                { api!!.wsUrl() },
                { SecureStore.tokens(this@SessionService)?.accessToken },
            ) { message ->
                when (message.optString("type")) {
                    "signal" -> {
                        if (message.optString("sessionId") == id) {
                            rtc?.onSignal(message.getJSONObject("payload"))
                        }
                    }
                    "session.update" -> {
                        val session = message.optJSONObject("data")?.optJSONObject("session")
                            ?: message.optJSONObject("session")
                        if (session?.optString("id") == id) {
                            when (session.optString("status")) {
                                "ended", "denied", "expired" -> scope.launch(Dispatchers.Main.immediate) { finishSession() }
                                "active" -> updateNotification()
                            }
                        }
                    }
                }
            }.also { realtime = it }
            socket.start()
            rtc = RtcClient(
                applicationContext,
                socket,
                id,
                sessionKind,
                projection,
                ice,
            ) { state ->
                if (sessionId != id) return@RtcClient
                currentState = state
                active.value = Active(id, sessionKind, state)
                if (state == "connected") updateNotification()
            }.also { it.start() }
            updateNotification()
        }
    }

    private fun stopByChild() {
        val id = sessionId
        scope.launch {
            if (id != null) runCatching { api?.endSession(id, "child_stopped") }
            withContext(Dispatchers.Main.immediate) { finishSession() }
        }
    }

    private fun finishSession() {
        if (ending) return
        ending = true
        sessionId = null
        rtc?.dispose()
        rtc = null
        realtime?.stop()
        realtime = null
        active.value = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Active sessions", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown for every camera, audio or screen session approved on this device"
                    setShowBadge(true)
                },
            )
        }
    }

    private fun label(): String = when (kind) {
        "camera" -> "Camera session"
        "audio" -> "Microphone session"
        "screen" -> "Screen sharing session"
        else -> "Session"
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            stopIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("${label()} is active")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text Android shows its privacy indicator. Tap Stop to end this session immediately."))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setContentIntent(open)
            .addAction(0, "Stop session", stop)
            .build()
    }

    private fun updateNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        val text = when (currentState) {
            "connected" -> "Connected. Your parent can see or hear this approved session."
            "connecting", "offer_sent" -> "Waiting for the parent to join…"
            "failed" -> "Connection problem. Tap Stop to end the session."
            "stopped" -> "Capture stopped by Android."
            else -> "Session visible and recorded in the access history."
        }
        manager.notify(NOTIFICATION_ID, notification(text))
    }

    override fun onDestroy() {
        rtc?.dispose()
        realtime?.stop()
        active.value = null
        scope.cancel()
        super.onDestroy()
    }
}
