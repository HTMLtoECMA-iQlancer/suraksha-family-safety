package app.suraksha.child

import org.json.JSONArray
import org.json.JSONObject

data class JsonTokens(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: String?,
    val refreshExpiresAt: String?,
) {
    fun accessExpired(): Boolean {
        val expiry = accessExpiresAt ?: return false
        return runCatching { java.time.Instant.parse(expiry).isBefore(java.time.Instant.now().plusSeconds(60)) }
            .getOrDefault(false)
    }
}

data class PermissionState(
    val key: String,
    val label: String,
    val granted: Boolean,
    val requiredFor: String,
)

data class SessionState(
    val id: String,
    val kind: String,
    val status: String,
    val parentName: String,
    val reason: String,
    val createdAt: String,
    val endedBy: String?,
    val trusted: Boolean = false,
) {
    val title: String
        get() = when (kind) {
            "camera" -> "Camera session"
            "audio" -> "Live audio session"
            "screen" -> "Screen sharing session"
            else -> "Session"
        }
}

data class DeviceProfile(
    val id: String,
    val childName: String,
    val name: String,
    val model: String,
    val platform: String,
    val status: String,
    val online: Boolean,
    val battery: Int?,
    val network: String?,
    val appVersion: String,
    val familyName: String,
    val parents: List<String>,
    val permissions: List<PermissionState>,
    val sessions: List<SessionState>,
    val pairingStatus: String? = null,
    val trustedCheckIn: TrustedCheckInState = TrustedCheckInState(),
)

data class TrustedCheckInState(
    val enabled: Boolean = false,
    val kinds: List<String> = emptyList(),
    val updatedAt: String? = null,
)

data class AccessEntry(
    val id: String,
    val action: String,
    val actorType: String,
    val createdAt: String,
)

data class ServerConfig(
    val turnUrls: List<String>,
    val turnUsername: String?,
    val turnCredential: String?,
)

data class UsageEntry(val packageName: String, val appName: String, val category: String, val minutes: Int)

object Json {
    fun encodeTokens(tokens: JsonTokens): String = JSONObject().apply {
        put("accessToken", tokens.accessToken)
        put("refreshToken", tokens.refreshToken)
        put("accessExpiresAt", (tokens.accessExpiresAt ?: JSONObject.NULL) as Any)
        put("refreshExpiresAt", (tokens.refreshExpiresAt ?: JSONObject.NULL) as Any)
    }.toString()

    fun decodeTokens(raw: String): JsonTokens? = runCatching {
        val json = JSONObject(raw)
        JsonTokens(
            accessToken = json.getString("accessToken"),
            refreshToken = json.getString("refreshToken"),
            accessExpiresAt = json.optString("accessExpiresAt").takeIf { it.isNotBlank() && it != "null" },
            refreshExpiresAt = json.optString("refreshExpiresAt").takeIf { it.isNotBlank() && it != "null" },
        )
    }.getOrNull()

    fun tokens(json: JSONObject): JsonTokens = JsonTokens(
        accessToken = json.getString("accessToken"),
        refreshToken = json.getString("refreshToken"),
        accessExpiresAt = json.optString("accessExpiresAt").takeIf { it.isNotBlank() && it != "null" },
        refreshExpiresAt = json.optString("refreshExpiresAt").takeIf { it.isNotBlank() && it != "null" },
    )

    fun permission(json: JSONObject): PermissionState = PermissionState(
        key = json.optString("key"),
        label = json.optString("label"),
        granted = json.optBoolean("granted"),
        requiredFor = json.optString("requiredFor"),
    )

    fun session(json: JSONObject): SessionState = SessionState(
        id = json.getString("id"),
        kind = json.optString("kind", "camera"),
        status = json.optString("status", "pending"),
        parentName = json.optString("parentName", "Parent"),
        reason = json.optString("reason", ""),
        createdAt = json.optString("createdAt"),
        endedBy = json.optString("endedBy").takeIf { it.isNotBlank() && it != "null" },
        trusted = json.optBoolean("trusted"),
    )

    fun trusted(json: JSONObject?): TrustedCheckInState {
        if (json == null) return TrustedCheckInState()
        val kinds = mutableListOf<String>()
        val array = json.optJSONArray("kinds") ?: JSONArray()
        for (i in 0 until array.length()) kinds.add(array.optString(i))
        return TrustedCheckInState(
            enabled = json.optBoolean("enabled"),
            kinds = kinds,
            updatedAt = json.optString("updatedAt").takeIf { it.isNotBlank() && it != "null" },
        )
    }

    fun device(json: JSONObject): DeviceProfile {
        val permissions = mutableListOf<PermissionState>()
        val permissionArray = json.optJSONArray("permissions") ?: JSONArray()
        for (i in 0 until permissionArray.length()) permissions.add(permission(permissionArray.getJSONObject(i)))
        return DeviceProfile(
            id = json.getString("id"),
            childName = json.optString("childName", "Child"),
            name = json.optString("name", "This device"),
            model = json.optString("model", "Android"),
            platform = json.optString("platform", "android"),
            status = json.optString("status", "offline"),
            online = json.optBoolean("online"),
            battery = json.optInt("battery", -1).takeIf { it >= 0 },
            network = json.optString("network").takeIf { it.isNotBlank() && it != "null" },
            appVersion = json.optString("appVersion", ""),
            familyName = "",
            parents = emptyList(),
            permissions = permissions,
            sessions = emptyList(),
            trustedCheckIn = trusted(json.optJSONObject("trustedCheckIn")),
        )
    }

    fun me(json: JSONObject): DeviceProfile {
        val device = device(json.getJSONObject("device"))
        val family = json.optJSONObject("family")
        val parents = mutableListOf<String>()
        val parentArray = json.optJSONArray("parents") ?: JSONArray()
        for (i in 0 until parentArray.length()) parents.add(parentArray.getJSONObject(i).optString("displayName"))
        val sessions = mutableListOf<SessionState>()
        val sessionArray = json.optJSONArray("sessions") ?: JSONArray()
        for (i in 0 until sessionArray.length()) sessions.add(session(sessionArray.getJSONObject(i)))
        return device.copy(
            familyName = family?.optString("name").orEmpty(),
            parents = parents,
            sessions = sessions,
            pairingStatus = json.optJSONObject("pairing")?.optString("status")?.takeIf { it.isNotBlank() },
        )
    }

    fun access(raw: JSONArray): List<AccessEntry> = buildList {
        for (i in 0 until raw.length()) {
            val json = raw.getJSONObject(i)
            add(
                AccessEntry(
                    id = json.optString("id"),
                    action = json.optString("action"),
                    actorType = json.optString("actor_type", json.optString("actorType", "system")),
                    createdAt = json.optString("created_at", json.optString("createdAt")),
                ),
            )
        }
    }

    fun config(json: JSONObject): ServerConfig = ServerConfig(
        turnUrls = mutableListOf<String>().apply {
            val urls = json.optJSONArray("turnUrls") ?: JSONArray()
            for (i in 0 until urls.length()) add(urls.getString(i))
        },
        turnUsername = json.optString("turnUsername").takeIf { it.isNotBlank() },
        turnCredential = json.optString("turnCredential").takeIf { it.isNotBlank() },
    )

    fun usagePayload(entries: List<UsageEntry>, day: String): String = JSONObject().apply {
        put("day", day)
        put("entries", JSONArray().apply {
            entries.forEach { entry ->
                put(JSONObject().apply {
                    put("package", entry.packageName)
                    put("appName", entry.appName)
                    put("category", entry.category)
                    put("minutes", entry.minutes)
                })
            }
        })
    }.toString()

    fun permissionPayload(key: String, granted: Boolean): String = JSONObject().apply {
        put("key", key)
        put("granted", granted)
    }.toString()
}
