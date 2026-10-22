package com.luap.okpicker

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.provider.Settings

// The launcher icon: first run goes through the setup wizard, afterwards it just (re)shows the overlay.
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // adb am start ... --es ips 127.0.0.1 --ei port 32035 --es gen G#1:2022.12 --es pass <rotated>
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) intent.getStringExtra("pass")?.let { pass ->
            PairStore(this).saveReconnect(
                (intent.getStringExtra("ips") ?: "127.0.0.1").split(','), intent.getIntExtra("port", 32035),
                intent.getStringExtra("gen") ?: "", pass,
            )
        }
        if (!Settings.canDrawOverlays(this) || !SetupActivity.done(this)) {
            startActivity(Intent(this, SetupActivity::class.java))
        } else {
            startForegroundService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_SHOW))
        }
        finish()
    }
}
