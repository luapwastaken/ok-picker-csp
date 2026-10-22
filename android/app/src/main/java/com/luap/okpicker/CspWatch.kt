package com.luap.okpicker

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process

// Is Clip Studio on screen? Read from the usage events Android keeps (needs Usage access), so the picker shows only
// over CSP and hides over every other app. CSP's resumed activities are tracked as a set, so split screen counts too.
class CspWatch(private val context: Context, private val onChange: (Boolean) -> Unit) {
    private val usm = context.getSystemService(UsageStatsManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val resumed = mutableSetOf<String>()
    private var since = 0L
    private var front: Boolean? = null

    fun start() {
        // CSP may have been in front for a long while (the service restarted after an update): look back a day, since
        // the screen turning off pauses it at least that often. Ten minutes missed a long session and hid the picker.
        since = System.currentTimeMillis() - 24 * 3_600_000L
        tick()
    }

    fun stop() = main.removeCallbacksAndMessages(null)

    private fun tick() {
        val now = System.currentTimeMillis()
        val events = usm.queryEvents(since, now)
        since = now - 2000 // overlap: re-reading a stretch in order is harmless, missing an event is not
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.packageName != CSP) continue
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> resumed += e.className
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> resumed -= e.className
            }
        }
        val f = resumed.isNotEmpty()
        if (f != front) { front = f; onChange(f) }
        main.postDelayed(::tick, 700)
    }

    companion object {
        const val CSP = "jp.co.celsys.clipstudiopaint.googleplay"

        fun allowed(context: Context): Boolean =
            context.getSystemService(AppOpsManager::class.java)
                .unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }
}
