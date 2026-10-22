package com.luap.okpicker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings

// Starts the picker with the tablet (and after an update), so it is there when Clip Studio opens.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!SetupActivity.done(context) || !Settings.canDrawOverlays(context)) return
        context.startForegroundService(Intent(context, OverlayService::class.java))
    }
}
