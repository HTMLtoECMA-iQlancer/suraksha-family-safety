package app.suraksha.child

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

data class ChildUiState(
    val booting: Boolean = true,
    val linked: Boolean = false,
    val profile: DeviceProfile? = null,
    val pending: List<SessionState> = emptyList(),
    val access: List<AccessEntry> = emptyList(),
    val connected: Boolean = false,
    val busy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class ChildViewModel(app: Application) : AndroidViewModel(app) {
    private val api = Api(app)
    private val _state = MutableStateFlow(ChildUiState())
    val state: StateFlow<ChildUiState> = _state
    private var realtime: Realtime? = null
    private var heartbeatJob: kotlinx.coroutines.Job? = null
    private val trustedStarting = mutableSetOf<String>()

    init {
        viewModelScope.launch {
            if (SecureStore.tokens(getApplication()) == null) {
                _state.value = _state.value.copy(booting = false, linked = false)
                return@launch
            }
            runCatching { api.me() }
                .onSuccess { profile ->
                    _state.value = _state.value.copy(booting = false, linked = true, profile = profile, pending = profile.sessions.filter { it.status == "pending" })
                    profile.sessions.filter { it.status == "approved" && it.trusted }.forEach(::maybeStartTrusted)
                    connectSocket()
                    startLoops()
                    syncInBackground()
                }
                .onFailure { err ->
                    if (err is ApiException && err.code == 401) {
                        SecureStore.clear(getApplication())
                        _state.value = ChildUiState(booting = false, linked = false)
                    } else {
                        _state.value = _state.value.copy(booting = false, linked = true, error = err.message)
                    }
                }
        }
    }

    private fun connectSocket() {
        if (realtime != null) return
        val socket = Realtime(
            viewModelScope,
            { api.wsUrl() },
            { SecureStore.tokens(getApplication())?.accessToken },
        ) { message -> handleRealtime(message) }
        realtime = socket
        viewModelScope.launch {
            socket.connected.collect { connected ->
                _state.update { it.copy(connected = connected) }
            }
        }
        socket.start()
    }

    private fun handleRealtime(message: JSONObject) {
        when (message.optString("type")) {
            "session.request", "session.update" -> {
                val session = message.optJSONObject("data")?.optJSONObject("session") ?: return
                val parsed = Json.session(session)
                _state.update { current ->
                    val pending = current.pending.filterNot { it.id == parsed.id }.toMutableList()
                    if (parsed.status == "pending") pending.add(0, parsed)
                    current.copy(pending = pending)
                }
                if (parsed.status == "ended" || parsed.status == "denied" || parsed.status == "expired") {
                    if (SessionService.active.value?.sessionId == parsed.id) {
                        getApplication<Application>().stopService(SessionService.stopIntent(getApplication()))
                    }
                }
                if (parsed.status == "approved" && parsed.trusted) maybeStartTrusted(parsed)
                viewModelScope.launch { runCatching { loadAccess() } }
            }

            "family.changed" -> sync()

            "device.unlinked" -> {
                SecureStore.clear(getApplication())
                realtime?.stop()
                realtime = null
                _state.value = ChildUiState(booting = false, linked = false, error = "This device was unlinked by the family")
            }
        }
    }

    private suspend fun loadAccess() {
        val access = api.accessHistory()
        _state.update { it.copy(access = access) }
    }

    fun pair(code: String, childName: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true, error = null)
            try {
                api.pair(
                    code = code.trim().uppercase(),
                    childName = childName.trim().ifBlank { null },
                    model = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                    osVersion = "Android ${Build.VERSION.RELEASE}",
                    appVersion = "1.0.0",
                )
                val profile = api.me()
                _state.value = _state.value.copy(busy = false, linked = true, profile = profile)
                connectSocket()
                startLoops()
                syncInBackground()
            } catch (err: Exception) {
                _state.value = _state.value.copy(busy = false, error = err.message ?: "Pairing failed")
            }
        }
    }

    fun sync() {
        viewModelScope.launch {
            try {
                val profile = api.me()
                _state.value = _state.value.copy(
                    profile = profile,
                    pending = profile.sessions.filter { it.status == "pending" },
                    error = null,
                )
                profile.sessions.filter { it.status == "approved" && it.trusted }.forEach(::maybeStartTrusted)
                loadAccess()
                connectSocket()
            } catch (err: Exception) {
                _state.value = _state.value.copy(error = err.message)
            }
        }
    }

    fun syncInBackground() {
        viewModelScope.launch { runCatching { heartBeat() } }
        viewModelScope.launch { runCatching { loadAccess() } }
        viewModelScope.launch { runCatching { reportUsageNow() } }
        viewModelScope.launch { reportLocationNow() }
    }

    private fun startLoops() {
        heartbeatJob?.cancel()
        heartbeatJob = viewModelScope.launch {
            while (isActive) {
                runCatching { heartBeat() }
                delay(45_000)
            }
        }
        viewModelScope.launch {
            while (isActive) {
                delay(15 * 60_000)
                runCatching { reportUsageNow() }
                runCatching { api.ensureFreshToken() }
            }
        }
        viewModelScope.launch {
            while (isActive) {
                delay(5 * 60_000)
                reportLocationNow()
            }
        }
    }

    private suspend fun heartBeat() {
        if (SecureStore.tokens(getApplication()) == null) return
        val battery = batteryLevel()
        val network = networkName()
        val permissions = PermissionProbe.snapshot(getApplication())
        val profile = api.heartbeat(battery, network, permissions).copy(
            familyName = _state.value.profile?.familyName.orEmpty(),
            parents = _state.value.profile?.parents.orEmpty(),
            sessions = _state.value.profile?.sessions.orEmpty(),
            pairingStatus = _state.value.profile?.pairingStatus,
        )
        _state.value = _state.value.copy(profile = profile, linked = true, error = null)
    }

    suspend fun reportUsageNow() {
        val report = UsageReporter.collect(getApplication()) ?: return
        api.reportUsage(report.entries, report.day)
    }

    fun reportLocationNow() {
        LocationReporter.requestOnce(getApplication()) { location ->
            viewModelScope.launch {
                runCatching { api.reportLocation(location.latitude, location.longitude, location.accuracy) }
            }
        }
    }

    fun approve(session: SessionState, projectionData: Intent? = null) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true, error = null)
            try {
                api.respond(session.id, true)
                api.startSession(session.id)
                val intent = SessionService.startIntent(getApplication(), session.id, session.kind, projectionData)
                ContextCompat.startForegroundService(getApplication(), intent)
                _state.value = _state.value.copy(
                    busy = false,
                    pending = _state.value.pending.filterNot { it.id == session.id },
                )
            } catch (err: Exception) {
                _state.value = _state.value.copy(busy = false, error = err.message)
            }
        }
    }

    fun deny(session: SessionState) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            try {
                api.respond(session.id, false, "Declined on the child device")
                _state.value = _state.value.copy(
                    busy = false,
                    pending = _state.value.pending.filterNot { it.id == session.id },
                )
            } catch (err: Exception) {
                _state.value = _state.value.copy(busy = false, error = err.message)
            }
        }
    }

    private fun maybeStartTrusted(session: SessionState) {
        if (session.kind == "screen") return
        if (SessionService.active.value?.sessionId == session.id) return
        synchronized(trustedStarting) {
            if (!trustedStarting.add(session.id)) return
        }
        viewModelScope.launch {
            try {
                val app = getApplication<Application>()
                val cameraGranted = ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                val micGranted = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                val missing = if (session.kind == "audio") !micGranted else !cameraGranted || !micGranted
                if (missing) {
                    runCatching { api.endSession(session.id, "permission_missing") }
                    _state.update {
                        it.copy(error = "Quick check-in could not start because camera or microphone permission is off.")
                    }
                    return@launch
                }
                api.startSession(session.id)
                ContextCompat.startForegroundService(
                    app,
                    SessionService.startIntent(app, session.id, session.kind, null),
                )
                _state.update { it.copy(pending = it.pending.filterNot { pending -> pending.id == session.id }) }
                runCatching { loadAccess() }
            } catch (err: Exception) {
                _state.update { it.copy(error = err.message) }
            } finally {
                synchronized(trustedStarting) { trustedStarting.remove(session.id) }
            }
        }
    }

    fun setTrustedAccess(enabled: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                val trusted = api.setTrustedAccess(enabled)
                _state.update {
                    it.copy(
                        busy = false,
                        profile = it.profile?.copy(trustedCheckIn = trusted),
                        message = if (enabled) {
                            "Quick check-ins are on. A parent can start a visible camera or audio check, and you can stop it."
                        } else {
                            "Quick check-ins are off. New camera or audio checks need your approval."
                        },
                    )
                }
                runCatching { loadAccess() }
            } catch (err: Exception) {
                _state.update { it.copy(busy = false, error = err.message) }
            }
        }
    }

    fun stopActiveSession() {
        val app = getApplication<Application>()
        app.startService(SessionService.stopIntent(app))
    }

    fun updatePermission(key: String, granted: Boolean) {
        viewModelScope.launch { runCatching { api.setPermission(key, granted) } }
    }

    fun sendSos() {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            try {
                api.sos()
                _state.value = _state.value.copy(busy = false, message = "SOS sent to your family")
            } catch (err: Exception) {
                _state.value = _state.value.copy(busy = false, error = err.message)
            }
        }
    }

    fun unlink() {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            runCatching { api.unlink() }
            realtime?.stop()
            realtime = null
            heartbeatJob?.cancel()
            val app = getApplication<Application>()
            app.stopService(SessionService.stopIntent(app))
            _state.value = ChildUiState(booting = false, linked = false)
        }
    }

    fun saveServer(url: String): String? {
        val cleaned = url.trim().trimEnd('/')
        if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
            return "Start with http:// or https://"
        }
        SecureStore.setServerUrl(getApplication(), cleaned)
        return null
    }

    fun consumeMessage() {
        _state.value = _state.value.copy(message = null, error = null)
    }

    fun note(message: String) {
        _state.value = _state.value.copy(message = message)
    }

    private fun batteryLevel(): Int? {
        val manager = getApplication<Application>().getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return level.takeIf { it in 0..100 }
    }

    private fun networkName(): String? {
        val manager = getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return null
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Mobile data"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            else -> "Offline"
        }
    }
}
