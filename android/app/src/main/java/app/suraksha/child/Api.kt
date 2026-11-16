package app.suraksha.child

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val code: Int, message: String) : IOException(message)

class Api(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val refreshLock = Mutex()

    fun baseUrl(): String = SecureStore.serverUrl(context)
    fun wsUrl(): String {
        val base = baseUrl().replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
        return "$base/ws?token="
    }

    private suspend fun execute(request: Request): JSONObject = withContext(Dispatchers.IO) {
        val response = client.newCall(request).await()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val message = runCatching {
                JSONObject(body).optJSONObject("error")?.optString("message")
            }.getOrNull().takeIf { !it.isNullOrBlank() }
                ?: "Request failed (${response.code})"
            throw ApiException(response.code, message)
        }
        if (body.isBlank()) JSONObject() else JSONObject(body)
    }

    private suspend fun call(
        path: String,
        method: String = "GET",
        body: String? = null,
        auth: Boolean = true,
        retry: Boolean = true,
    ): JSONObject {
        val builder = Request.Builder().url(baseUrl() + "/api" + path)
        val media = "application/json".toMediaType()
        val payload = body?.toRequestBody(media)
        when (method) {
            "POST" -> builder.post(payload ?: "{}".toRequestBody(media))
            "PUT" -> builder.put(payload ?: "{}".toRequestBody(media))
            "DELETE" -> builder.delete()
            else -> builder.get()
        }
        if (auth) {
            val token = tokens()?.accessToken ?: throw ApiException(401, "This device is not linked yet")
            if (tokens()!!.accessExpired()) ensureFreshToken()
            builder.header("Authorization", "Bearer ${tokens()?.accessToken ?: token}")
        }
        return try {
            execute(builder.build())
        } catch (err: ApiException) {
            if (err.code == 401 && auth && retry) {
                ensureFreshToken()
                call(path, method, body, auth, retry = false)
            } else {
                throw err
            }
        }
    }

    private fun tokens(): JsonTokens? = SecureStore.tokens(context)

    suspend fun ensureFreshToken() {
        refreshLock.withLock {
            val current = tokens() ?: throw ApiException(401, "This device is not linked yet")
            if (!current.accessExpired()) return
            val json = call("/child/token/refresh", "POST", JSONObject().put("refreshToken", current.refreshToken).toString(), auth = false, retry = false)
            SecureStore.saveTokens(context, Json.tokens(json.getJSONObject("tokens")))
        }
    }

    suspend fun config(): ServerConfig = Json.config(call("/config", auth = false))

    suspend fun pair(
        code: String,
        childName: String?,
        model: String,
        osVersion: String,
        appVersion: String,
    ): Pair<JsonTokens, DeviceProfile> {
        val body = JSONObject().apply {
            put("code", code)
            if (!childName.isNullOrBlank()) put("childName", childName)
            put("platform", "android")
            put("model", model)
            put("osVersion", osVersion)
            put("appVersion", appVersion)
        }
        val json = call("/child/pair", "POST", body.toString(), auth = false)
        val tokens = Json.tokens(json.getJSONObject("tokens"))
        SecureStore.saveTokens(context, tokens)
        return tokens to Json.device(json.getJSONObject("device"))
    }

    suspend fun me(): DeviceProfile = Json.me(call("/child/me"))

    suspend fun heartbeat(battery: Int?, network: String?, permissions: List<PermissionState>): DeviceProfile {
        val body = JSONObject().apply {
            put("battery", (battery ?: JSONObject.NULL) as Any)
            put("network", (network ?: JSONObject.NULL) as Any)
            put("appVersion", "1.0.0")
            put("permissionStatus", org.json.JSONArray().apply {
                permissions.forEach {
                    put(JSONObject().apply {
                        put("key", it.key)
                        put("label", it.label)
                        put("granted", it.granted)
                        put("requiredFor", it.requiredFor)
                    })
                }
            })
        }
        val json = call("/child/heartbeat", "POST", body.toString())
        return Json.device(json.getJSONObject("device"))
    }

    suspend fun setPermission(key: String, granted: Boolean) {
        call("/child/permissions", "POST", Json.permissionPayload(key, granted))
    }

    suspend fun setTrustedAccess(enabled: Boolean): TrustedCheckInState {
        val json = call(
            "/child/trusted-access",
            "POST",
            JSONObject().put("enabled", enabled).put("confirmed", true).toString(),
        )
        return Json.trusted(json.optJSONObject("trustedCheckIn"))
    }

    suspend fun respond(sessionId: String, approve: Boolean, reason: String = ""): SessionState {
        val json = call(
            "/child/session-requests/$sessionId/respond",
            "POST",
            JSONObject().put("approve", approve).put("reason", reason).toString(),
        )
        return Json.session(json.getJSONObject("session"))
    }

    suspend fun startSession(sessionId: String): SessionState {
        val json = call("/child/sessions/$sessionId/start", "POST", "{}")
        return Json.session(json.getJSONObject("session"))
    }

    suspend fun endSession(sessionId: String, reason: String = "child_stopped"): SessionState {
        val json = call(
            "/child/sessions/$sessionId/end",
            "POST",
            JSONObject().put("reason", reason).toString(),
        )
        return Json.session(json.getJSONObject("session"))
    }

    suspend fun accessHistory(): List<AccessEntry> =
        Json.access(call("/child/access-history").optJSONArray("audit") ?: org.json.JSONArray())

    suspend fun reportUsage(entries: List<UsageEntry>, day: String) {
        call("/child/usage", "POST", Json.usagePayload(entries, day))
    }

    suspend fun reportLocation(lat: Double, lng: Double, accuracy: Float) {
        call(
            "/child/location",
            "POST",
            JSONObject().put("lat", lat).put("lng", lng).put("accuracy", accuracy.toDouble()).toString(),
        )
    }

    suspend fun sos() {
        call("/child/sos", "POST", "{}")
    }

    suspend fun unlink() {
        call("/child/unlink", "POST", JSONObject().put("confirm", true).toString())
        SecureStore.clear(context)
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (cont.isActive) cont.resume(response) else response.close()
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
