package app.suraksha.child

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * The child app keeps one authenticated WebSocket open while it is in the foreground.
 * If the process is killed Android closes the socket, so the parent sees the device as
 * offline instead of believing a hidden background service is watching.
 */
class Realtime(
    private val scope: CoroutineScope,
    private val urlProvider: () -> String,
    private val tokenProvider: () -> String?,
    private val onMessage: (JSONObject) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    private var socket: WebSocket? = null
    private var loop: Job? = null
    private var stopped = true

    fun start() {
        if (!stopped) return
        stopped = false
        loop = scope.launch {
            var backoff = 1_000L
            while (!stopped) {
                val token = tokenProvider()
                if (token == null) {
                    delay(2_000)
                    continue
                }
                val opened = open(token)
                if (!opened) {
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(20_000)
                } else {
                    backoff = 1_000
                }
                delay(1_000)
                while (!stopped && _connected.value) delay(1_000)
            }
        }
    }

    private suspend fun open(token: String): Boolean = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        val request = Request.Builder().url(urlProvider() + token).build()
        var resumed = false
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connected.value = true
                if (!resumed) { resumed = true; cont.resume(true) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { JSONObject(text) }.onSuccess(onMessage)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connected.value = false
                if (!resumed) { resumed = true; cont.resume(false) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("SurakshaChild", "socket failure: ${t.message} code=${response?.code}")
                _connected.value = false
                if (!resumed) { resumed = true; cont.resume(false) }
            }
        })
        cont.invokeOnCancellation { socket?.cancel() }
    }

    fun send(type: String, sessionId: String, payload: JSONObject? = null) {
        val text = JSONObject().apply {
            put("type", type)
            put("sessionId", sessionId)
            if (payload != null) put("payload", payload)
        }.toString()
        socket?.send(text)
    }

    fun sendReady(sessionId: String) {
        socket?.send(JSONObject().put("type", "webrtc.ready").put("sessionId", sessionId).toString())
    }

    fun stop() {
        stopped = true
        _connected.value = false
        socket?.close(1000, "app hidden")
        socket = null
        loop?.cancel()
        loop = null
    }
}
