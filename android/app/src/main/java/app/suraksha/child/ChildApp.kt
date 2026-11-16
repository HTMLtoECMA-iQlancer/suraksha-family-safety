package app.suraksha.child

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BatteryStd
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ScreenShare
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Sos
import androidx.compose.material.icons.rounded.StopCircle
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Brand = Color(0xFF1E63E9)
private val BrandDeep = Color(0xFF0B3FA8)
private val Green = Color(0xFF12A150)
private val Amber = Color(0xFFB45309)
private val Red = Color(0xFFD92D20)

@Composable
fun SurakshaTheme(content: @Composable () -> Unit) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(
            primary = Color(0xFF7FA8FF),
            onPrimary = Color(0xFF002B66),
            background = Color(0xFF0E1421),
            surface = Color(0xFF151D2E),
            onSurface = Color(0xFFE8EDF7),
            surfaceVariant = Color(0xFF1E283C),
        )
    } else {
        lightColorScheme(
            primary = Brand,
            onPrimary = Color.White,
            background = Color(0xFFF4F6FB),
            surface = Color.White,
            onSurface = Color(0xFF101828),
            surfaceVariant = Color(0xFFF0F3FA),
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun ChildApp(
    state: ChildUiState,
    active: SessionService.Active?,
    serverUrl: String,
    onPair: (String, String) -> Unit,
    onApprove: (SessionState) -> Unit,
    onDeny: (SessionState) -> Unit,
    onStopActive: () -> Unit,
    onSos: () -> Unit,
    onShareLocation: () -> Unit,
    onRefresh: () -> Unit,
    onPermissionAction: (String) -> Unit,
    onTrustedAccess: (Boolean) -> Unit,
    onSaveServer: (String) -> String?,
    onUnlink: () -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(0) }
    var showActive by remember { mutableStateOf(false) }
    LaunchedEffect(active?.sessionId) {
        if (active != null) showActive = true
    }
    if (state.booting) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
            Text("Opening Suraksha Child…", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        }
        return
    }
    if (!state.linked) {
        PairScreen(
            busy = state.busy,
            serverUrl = serverUrl,
            onPair = onPair,
            onSaveServer = onSaveServer,
        )
        return
    }
    if (state.profile?.pairingStatus?.let { it != "linked" } == true) {
        AwaitingParentScreen(onRefresh)
        return
    }
    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf("Home" to Icons.Rounded.Home, "Permissions" to Icons.Rounded.Lock, "Access" to Icons.Rounded.History, "Settings" to Icons.Rounded.Settings)
                    .forEachIndexed { index, (label, icon) ->
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { tab = index },
                            icon = { Icon(icon, contentDescription = label) },
                            label = { Text(label, fontSize = 11.sp) },
                        )
                    }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ConnectionStrip(state.connected)
            when (tab) {
                0 -> HomeScreen(
                    state = state,
                    active = active,
                    onApprove = onApprove,
                    onDeny = onDeny,
                    onSos = onSos,
                    onShareLocation = onShareLocation,
                    onRefresh = onRefresh,
                    onOpenActive = { showActive = true },
                    onPermissionTab = { tab = 1 },
                    onSettingsTab = { tab = 3 },
                )
                1 -> PermissionsScreen(state, onPermissionAction, onRefresh)
                2 -> AccessScreen(state, onRefresh)
                else -> SettingsScreen(
                    state = state,
                    serverUrl = serverUrl,
                    onUnlink = onUnlink,
                    onSaveServer = onSaveServer,
                    onTrustedAccess = onTrustedAccess,
                    onOpenPermissions = { tab = 1 },
                )
            }
        }
    }
    if (active != null && showActive) {
        ActiveSessionDialog(active = active, onStop = { showActive = false; onStopActive() }, onDismiss = { showActive = false })
    }
}

@Composable
private fun AwaitingParentScreen(onRefresh: () -> Unit) {
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(4_000)
            onRefresh()
        }
    }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(Brand.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.CheckCircle, null, tint = Brand, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text("Almost paired", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Your parent still needs to approve this device in the Suraksha parent app. Nothing is shared until they approve, and you can unlink at any time afterwards.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        androidx.compose.material3.CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
        Spacer(Modifier.height(18.dp))
        OutlinedButton(onClick = onRefresh) { Icon(Icons.Rounded.Refresh, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Check again") }
    }
}

@Composable
private fun ConnectionStrip(connected: Boolean) {
    Row(
        Modifier.fillMaxWidth().background(if (connected) Green.copy(alpha = 0.12f) else Amber.copy(alpha = 0.14f)).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (connected) Icons.Rounded.CheckCircle else Icons.Rounded.Warning, null, tint = if (connected) Green else Amber, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            if (connected) "Connected to your family · this app is visible on your device" else "Reconnecting to your family…",
            fontSize = 12.sp,
            color = if (connected) Green else Amber,
        )
    }
}

@Composable
private fun PairScreen(busy: Boolean, serverUrl: String, onPair: (String, String) -> Unit, onSaveServer: (String) -> String?) {
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var server by rememberSaveable { mutableStateOf(serverUrl) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var showServer by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)
            .padding(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 20.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(Brand), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Shield, null, tint = Color.White)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("SURAKSHA CHILD", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Brand, letterSpacing = 1.2.sp)
                Text("Visible by design", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
                .background(Brush.linearGradient(listOf(Brand, BrandDeep))).padding(20.dp),
        ) {
            Text("Suraksha Child", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "This app helps your family keep you safe. It only shares what is listed here. Camera, microphone and screen sharing always show a visible indicator and only start when you tap Approve.",
                color = Color.White.copy(alpha = 0.92f),
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Lock, null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text("Suraksha never hides the app, hides a session, or turns on the camera or microphone by itself.", color = Color.White.copy(alpha = 0.9f), fontSize = 12.sp)
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Pair with your parent", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("Ask your parent for the 6-character code from their Suraksha app.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase().filter { ch -> ch.isLetterOrDigit() }.take(6) },
                    label = { Text("Pairing code") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(60) },
                    label = { Text("Your name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onPair(code, name) },
                    enabled = code.length == 6 && !busy,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Text(if (busy) "Pairing…" else "Pair this device")
                }
                Text(
                    "Android adds a persistent foreground notification and system privacy indicators to every approved session.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Devices, null, modifier = Modifier.size(18.dp), tint = Brand)
                    Spacer(Modifier.width(8.dp))
                    Text("Server", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { showServer = !showServer }) { Text(if (showServer) "Hide" else "Change") }
                }
                if (showServer) {
                    OutlinedTextField(
                        value = server,
                        onValueChange = { server = it },
                        label = { Text("Server URL") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    serverError?.let { Text(it, color = Red, fontSize = 12.sp) }
                    Button(
                        onClick = { serverError = onSaveServer(server) },
                        modifier = Modifier.padding(top = 8.dp),
                    ) { Text("Save server") }
                } else {
                    Text(serverUrl, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(
    state: ChildUiState,
    active: SessionService.Active?,
    onApprove: (SessionState) -> Unit,
    onDeny: (SessionState) -> Unit,
    onSos: () -> Unit,
    onShareLocation: () -> Unit,
    onRefresh: () -> Unit,
    onOpenActive: () -> Unit,
    onPermissionTab: () -> Unit,
    onSettingsTab: () -> Unit,
) {
    val profile = state.profile
    var confirmSos by remember { mutableStateOf(false) }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Brush.linearGradient(listOf(Brand, BrandDeep))).padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                    Text(profile?.childName?.take(1) ?: "C", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text("CHILD COMPANION", color = Color.White.copy(alpha = 0.75f), fontSize = 10.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.Bold)
                    Text(profile?.childName ?: "This device", color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                    Text("${profile?.name ?: "Android"} · ${profile?.familyName.orEmpty()}", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Row(Modifier.clip(RoundedCornerShape(20.dp)).background(Color.White.copy(alpha = 0.2f)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).clip(RoundedCornerShape(4.dp)).background(if (state.connected) Color(0xFF7CF1B2) else Color.White.copy(alpha = 0.7f)))
                        Spacer(Modifier.width(5.dp))
                        Text(if (state.connected) "Online" else "Offline", color = Color.White, fontSize = 11.sp)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("${profile?.battery ?: 0}% · ${profile?.network ?: "—"}", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                }
            }
        }
        item {
            TrustedCheckInBanner(state.profile?.trustedCheckIn, onSettingsTab)
        }
        if (active != null) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Red)) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.StopCircle, null, tint = Color.White)
                            Spacer(Modifier.width(8.dp))
                            Text("${kindLabel(active.kind)} is active", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                        Text("Android is showing its privacy indicator. Your parent can see or hear only this approved session.", color = Color.White.copy(alpha = 0.9f), fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = onOpenActive, colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) { Text("View details") }
                            Button(onClick = onOpenActive, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Red)) { Text("Stop session") }
                        }
                    }
                }
            }
        }
        item {
            Text("Session requests", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        if (state.pending.isEmpty()) {
            item {
                Card {
                    Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Info, null, tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                        Spacer(Modifier.width(10.dp))
                        Text(
                            if (state.profile?.trustedCheckIn?.enabled == true) {
                                "No requests waiting. Quick check-ins can start a visible camera or audio session without a new approval."
                            } else {
                                "No session requests right now. Your parent cannot start the camera, microphone or screen without your approval."
                            },
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }
            }
        }
        items(state.pending, key = { it.id }) { session ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Brand.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                            Icon(kindIcon(session.kind), null, tint = Brand)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            val media = when (session.kind) {
                                "screen" -> "screen"
                                "audio" -> "microphone"
                                else -> "camera and microphone"
                            }
                            Text(session.title, fontWeight = FontWeight.SemiBold)
                            Text("${session.parentName} asks · $media only", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                        }
                    }
                    if (session.reason.isNotBlank()) {
                        Text("“${session.reason}”", fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
                    }
                    Text(
                        "Approve starts only this session and shows a permanent notification with a Stop button. Android also shows its own privacy indicator.",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = { onApprove(session) }, enabled = !state.busy, modifier = Modifier.weight(1f)) { Text("Approve") }
                        OutlinedButton(onClick = { onDeny(session) }, enabled = !state.busy, modifier = Modifier.weight(1f)) { Text("Decline") }
                    }
                }
            }
        }
        item {
            Text("Quick actions", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickTile("Share location", Icons.Rounded.LocationOn, Modifier.weight(1f), onShareLocation)
                QuickTile("Send SOS", Icons.Rounded.Sos, Modifier.weight(1f), { confirmSos = true })
                QuickTile("Refresh", Icons.Rounded.Refresh, Modifier.weight(1f), onRefresh)
            }
        }
        item { PermissionsSummary(state, onPermissionTab) }
        item {
            Card {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Shield, null, tint = Green, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("What this app shares", fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Screen time by app, device status and battery, your shared location, SOS alerts, and approved live sessions. Every access is written to the access history on this device and shown to your family. Nothing is recorded secretly.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    )
                }
            }
        }
        if (state.access.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Recent access", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Spacer(Modifier.weight(1f))
                }
            }
            items(state.access.take(3), key = { it.id }) { entry ->
                AccessRow(entry)
            }
        }
    }
    if (confirmSos) {
        AlertDialog(
            onDismissRequest = { confirmSos = false },
            title = { Text("Send SOS to your family?") },
            text = { Text("Your parents get an urgent alert with your last shared location. This is not a hidden action — the alert is recorded in your access history too.") },
            confirmButton = { TextButton(onClick = { confirmSos = false; onSos() }) { Text("Send SOS", color = Red) } },
            dismissButton = { TextButton(onClick = { confirmSos = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun TrustedCheckInBanner(trusted: TrustedCheckInState?, onOpenSettings: () -> Unit) {
    val enabled = trusted?.enabled == true
    val accent = if (enabled) Green else Amber
    Card(colors = CardDefaults.cardColors(containerColor = accent.copy(alpha = 0.12f))) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Rounded.Shield, null, tint = accent, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (enabled) "Quick check-ins are on" else "Quick check-ins are off",
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    if (enabled) {
                        "A parent can start a visible camera or audio check without a new approval. Android shows its green indicator and a permanent notification, and you can stop any session."
                    } else {
                        "Turn on to let a parent check on you without waiting for an Approve tap. Camera and microphone permissions are needed; screen sharing still asks Android each time."
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                )
                TextButton(onClick = onOpenSettings, modifier = Modifier.padding(top = 2.dp)) {
                    Text(if (enabled) "Manage in Settings" else "Set up in Settings")
                }
            }
        }
    }
}

@Composable
private fun PermissionsSummary(state: ChildUiState, onOpen: () -> Unit) {
    val permissions = state.profile?.permissions.orEmpty()
    val granted = permissions.count { it.granted }
    val needed = permissions.size
    Card {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Lock, null, tint = Brand, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Permissions", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text("$granted/$needed granted", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
            Spacer(Modifier.height(8.dp))
            Text(
                if (granted == needed) "Everything needed is granted. You can still revoke each permission in Android settings."
                else "Some features stay off until you grant them. Suraksha asks only when a feature needs it.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            )
            TextButton(onClick = onOpen, modifier = Modifier.padding(top = 4.dp)) { Text("Open permission centre") }
        }
    }
}

@Composable
private fun QuickTile(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier.height(72.dp), shape = RoundedCornerShape(16.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = Brand, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(4.dp))
            Text(label, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun PermissionsScreen(state: ChildUiState, onAction: (String) -> Unit, onRefresh: () -> Unit) {
    val permissions = state.profile?.permissions.orEmpty()
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Permission centre", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    Text("You are in control. Revoke anything in Android settings at any time.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Rounded.Refresh, "Refresh") }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Brand.copy(alpha = 0.08f))) {
                Text(
                    "Suraksha requests permissions only when a feature is enabled, and explains the reason before asking. Android does not allow a parent to grant permissions on your behalf.",
                    fontSize = 12.sp,
                    modifier = Modifier.padding(14.dp),
                )
            }
        }
        items(permissions, key = { it.key }) { permission ->
            Card {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (permission.granted) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline,
                        null,
                        tint = if (permission.granted) Green else Amber,
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(permission.label, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(permission.requiredFor, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
                        Text(
                            if (permission.key == "screen_capture") "Asked by Android for each session"
                            else if (permission.granted) "Granted"
                            else "Not granted",
                            fontSize = 11.sp,
                            color = if (permission.granted) Green else Amber,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    TextButton(onClick = { onAction(permission.key) }) {
                        Text(
                            when {
                                permission.key == "screen_capture" -> "How"
                                permission.key == "accessibility" -> "Not used"
                                permission.granted -> "Review"
                                else -> "Grant"
                            },
                        )
                    }
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Screen capture", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Android shows a system dialog every time a screen session is approved. The capture always appears in the system privacy chip and the persistent Suraksha notification, and stops the moment you tap Stop.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    )
                }
            }
        }
    }
}

@Composable
private fun AccessScreen(state: ChildUiState, onRefresh: () -> Unit) {
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Who accessed this device", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    Text("Every session, policy change and pairing is listed here.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Rounded.Refresh, "Refresh") }
            }
        }
        items(state.access, key = { it.id }) { entry -> AccessRow(entry) }
        if (state.access.isEmpty()) {
            item { Text("No access records yet.", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)) }
        }
    }
}

@Composable
private fun AccessRow(entry: AccessEntry) {
    Card {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (entry.action.contains("session")) Icons.Rounded.CameraAlt else Icons.Rounded.History, null, tint = Brand, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(humanize(entry.action), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                Text("${entry.actorType.replaceFirstChar { it.uppercase() }} · ${relativeTime(entry.createdAt)}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    state: ChildUiState,
    serverUrl: String,
    onUnlink: () -> Unit,
    onSaveServer: (String) -> String?,
    onTrustedAccess: (Boolean) -> Unit,
    onOpenPermissions: () -> Unit,
) {
    var confirmUnlink by remember { mutableStateOf(false) }
    var confirmTrusted by remember { mutableStateOf(false) }
    var permissionHelp by remember { mutableStateOf(false) }
    var server by remember(serverUrl) { mutableStateOf(serverUrl) }
    var serverError by remember { mutableStateOf<String?>(null) }
    val trusted = state.profile?.trustedCheckIn ?: TrustedCheckInState()
    val permissions = state.profile?.permissions.orEmpty()
    val cameraOk = permissions.firstOrNull { it.key == "camera" }?.granted == true
    val micOk = permissions.firstOrNull { it.key == "microphone" }?.granted == true
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Settings", fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Card {
            Column(Modifier.padding(16.dp)) {
                Text("Linked family", fontWeight = FontWeight.SemiBold)
                Text(state.profile?.familyName.orEmpty(), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f))
                Spacer(Modifier.height(6.dp))
                Text("Parents: ${state.profile?.parents?.joinToString().orEmpty().ifBlank { "—" }}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
        }
        Card {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Server", fontWeight = FontWeight.SemiBold)
                OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("Server URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                serverError?.let { Text(it, color = Red, fontSize = 12.sp) }
                Text("Use your family's Suraksha server URL. An https:// address works over mobile data and Wi-Fi; 10.0.2.2 is emulator-only.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
                Button(onClick = { serverError = onSaveServer(server) }) { Text("Save") }
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = Brand.copy(alpha = 0.07f))) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Shield, null, tint = Brand, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Quick check-ins", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (trusted.enabled) "On · camera and microphone" else "Off",
                            fontSize = 12.sp,
                            color = if (trusted.enabled) Green else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                    Switch(
                        checked = trusted.enabled,
                        onCheckedChange = { checked ->
                            if (!checked) {
                                onTrustedAccess(false)
                            } else if (!cameraOk || !micOk) {
                                permissionHelp = true
                            } else {
                                confirmTrusted = true
                            }
                        },
                    )
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    if (trusted.enabled) {
                        "A parent can start a visible camera or audio check without a new Approve tap. Android still shows its green indicator and a permanent notification. Stop any session here, or turn quick check-ins off at any time."
                    } else {
                        "Turn on to let a parent check on you without waiting for an Approve tap. Android still shows every session, and screen sharing always asks Android separately."
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )
                if (!cameraOk || !micOk) {
                    Spacer(Modifier.height(6.dp))
                    Text("Camera and microphone permissions must be granted first.", fontSize = 12.sp, color = Amber)
                    TextButton(onClick = onOpenPermissions) { Text("Open permission centre") }
                }
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = Brand.copy(alpha = 0.07f))) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Shield, null, tint = Brand, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Privacy by design", fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Suraksha never disguises the app, hides its icon, conceals an active session, suppresses Android privacy indicators or collects data silently. Every live session shows a permanent notification and can be stopped here. Quick check-ins keep the same visible indicators and Stop control.",
                    fontSize = 12.sp,
                )
            }
        }
        Card {
            Column(Modifier.padding(16.dp)) {
                Text("Data and account", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text("Device: ${state.profile?.name.orEmpty()} · ${state.profile?.model.orEmpty()}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                Text("App version 1.0.0", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { confirmUnlink = true }, colors = ButtonDefaults.outlinedButtonColors(contentColor = Red)) { Text("Unlink this device") }
            }
        }
        Text("Handled by Android: usage access and screen capture are system permissions you can revoke in Settings at any time.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
    }
    if (confirmUnlink) {
        AlertDialog(
            onDismissRequest = { confirmUnlink = false },
            title = { Text("Unlink this device?") },
            text = { Text("Your family will stop seeing this device. You can pair again with a new code. This device stays fully visible — nothing is hidden after unlinking.") },
            confirmButton = { TextButton(onClick = { confirmUnlink = false; onUnlink() }) { Text("Unlink", color = Red) } },
            dismissButton = { TextButton(onClick = { confirmUnlink = false }) { Text("Cancel") } },
        )
    }
    if (confirmTrusted) {
        AlertDialog(
            onDismissRequest = { confirmTrusted = false },
            title = { Text("Turn on quick check-ins?") },
            text = {
                Text(
                    "A parent can then start a visible camera or microphone check without a new Approve tap. Android still shows its green privacy indicator and a permanent notification. You can stop any session and turn this off at any time. Screen sharing still asks Android each time.",
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmTrusted = false; onTrustedAccess(true) }) {
                    Text("Turn on")
                }
            },
            dismissButton = { TextButton(onClick = { confirmTrusted = false }) { Text("Cancel") } },
        )
    }
    if (permissionHelp) {
        AlertDialog(
            onDismissRequest = { permissionHelp = false },
            title = { Text("Camera and microphone needed") },
            text = { Text("Grant camera and microphone in the Permissions tab first. Quick check-ins cannot start without them.") },
            confirmButton = {
                TextButton(onClick = { permissionHelp = false; onOpenPermissions() }) { Text("Open permissions") }
            },
            dismissButton = { TextButton(onClick = { permissionHelp = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ActiveSessionDialog(active: SessionService.Active, onStop: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(kindIcon(active.kind), null, tint = Red) },
        title = { Text("${kindLabel(active.kind)} is active") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Android's privacy indicator is visible in the status bar, and a permanent notification stays until you stop.", fontSize = 13.sp)
                Text("State: ${active.state.replace('_', ' ')}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                Text("Stopping ends the session immediately for both you and your parent and records it in the access history.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
        },
        confirmButton = {
            Button(onClick = onStop, colors = ButtonDefaults.buttonColors(containerColor = Red)) {
                Icon(Icons.Rounded.StopCircle, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Stop session")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Keep running") } },
    )
}

private fun kindLabel(kind: String) = when (kind) {
    "camera" -> "Camera session"
    "audio" -> "Microphone session"
    "screen" -> "Screen sharing"
    else -> "Session"
}

private fun kindIcon(kind: String) = when (kind) {
    "camera" -> Icons.Rounded.CameraAlt
    "audio" -> Icons.Rounded.Mic
    "screen" -> Icons.Rounded.ScreenShare
    else -> Icons.Rounded.Notifications
}

private fun humanize(action: String): String = action
    .replace('.', ' ')
    .replace('_', ' ')
    .split(' ')
    .filter { it.isNotBlank() }
    .joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }
