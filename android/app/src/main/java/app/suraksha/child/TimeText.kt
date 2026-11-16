package app.suraksha.child

import java.time.Duration
import java.time.Instant

internal fun relativeTime(iso: String, now: Instant = Instant.now()): String {
    val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return "just now"
    val minutes = Duration.between(instant, now).toMinutes()
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes}m ago"
        minutes < 1440 -> "${minutes / 60}h ago"
        else -> "${minutes / 1440}d ago"
    }
}
