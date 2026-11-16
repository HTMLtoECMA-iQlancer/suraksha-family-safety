package app.suraksha.child

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.os.PowerManager
import androidx.core.content.ContextCompat
import android.app.usage.UsageStatsManager

object PermissionProbe {
    fun snapshot(context: Context): List<PermissionState> {
        fun granted(permission: String) =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        return listOf(
            PermissionState("camera", "Camera", granted(Manifest.permission.CAMERA), "Camera safety sessions"),
            PermissionState("microphone", "Microphone", granted(Manifest.permission.RECORD_AUDIO), "Live audio sessions"),
            PermissionState(
                "location",
                "Location (foreground)",
                granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION),
                "Location sharing and geofence alerts",
            ),
            PermissionState(
                "notifications",
                "Notifications",
                if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.POST_NOTIFICATIONS) else true,
                "Session requests and safety alerts",
            ),
            PermissionState("usage_access", "Usage access", usageAccess(context), "Screen-time summaries and app limits"),
            PermissionState(
                "screen_capture",
                "Screen capture",
                false,
                "Asked by Android at each approved screen session",
            ),
            PermissionState(
                "battery_optimization",
                "Ignore battery optimization (optional)",
                (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .isIgnoringBatteryOptimizations(context.packageName),
                "Reliable background heartbeats",
            ),
            PermissionState(
                "accessibility",
                "Accessibility service (optional)",
                false,
                "Only for device-owner managed blocking; not used by this build",
            ),
        )
    }

    fun usageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }
}

object UsageReporter {
    data class Report(val entries: List<UsageEntry>, val day: String, val totalMinutes: Int)

    fun collect(context: Context): Report? {
        if (!PermissionProbe.usageAccess(context)) return null
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val calendar = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0)
            set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        val stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, calendar.timeInMillis, now)
        val grouped = mutableMapOf<String, Long>()
        stats?.forEach { stat ->
            if (stat.totalTimeInForeground > 30_000) {
                grouped[stat.packageName] = (grouped[stat.packageName] ?: 0L) + stat.totalTimeInForeground
            }
        }
        val pm = context.packageManager
        val entries = grouped.entries
            .sortedByDescending { it.value }
            .take(50)
            .map { (pkg, ms) ->
                val label = runCatching {
                    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                }.getOrDefault(pkg)
                UsageEntry(pkg, label, category(pkg, label), (ms / 60_000L).toInt().coerceAtLeast(1))
            }
        val day = java.time.LocalDate.now().toString()
        return Report(entries, day, entries.sumOf { it.minutes })
    }

    private fun category(packageName: String, label: String): String {
        val text = "$packageName $label".lowercase()
        return when {
            listOf("youtube", "netflix", "prime", "hotstar", "video", "reels").any { it in text } -> "Video"
            listOf("whatsapp", "instagram", "snapchat", "telegram", "facebook", "social").any { it in text } -> "Social"
            listOf("game", "minecraft", "pubg", "clash", "roblox").any { it in text } -> "Games"
            listOf("school", "learn", "class", "duolingo", "byju", "khan").any { it in text } -> "Education"
            listOf("chrome", "browser", "firefox").any { it in text } -> "Browser"
            else -> "Other"
        }
    }
}

object LocationReporter {
    /** One foreground location fix; never collects while location sharing is off. */
    fun requestOnce(context: Context, onPoint: (Location) -> Unit) {
        val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) return
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }
        val provider = providers.firstOrNull() ?: return
        val last = runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
        if (last != null && System.currentTimeMillis() - last.time < 10 * 60_000) {
            onPoint(last)
            return
        }
        runCatching {
            manager.requestSingleUpdate(provider, { location -> onPoint(location) }, Looper.getMainLooper())
        }
    }
}
