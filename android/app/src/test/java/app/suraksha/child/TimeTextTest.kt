package app.suraksha.child

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class TimeTextTest {
    private val now = Instant.parse("2026-11-16T12:00:00Z")

    @Test
    fun formatsMinutesHoursAndDays() {
        assertEquals("just now", relativeTime("2026-11-16T11:59:30Z", now))
        assertEquals("5m ago", relativeTime("2026-11-16T11:55:00Z", now))
        assertEquals("2h ago", relativeTime("2026-11-16T10:00:00Z", now))
        assertEquals("3d ago", relativeTime("2026-11-13T12:00:00Z", now))
    }

    @Test
    fun fallsBackForInvalidOrFutureValues() {
        assertEquals("just now", relativeTime("not-a-date", now))
        assertEquals("just now", relativeTime("2026-11-16T13:00:00Z", now))
    }
}
