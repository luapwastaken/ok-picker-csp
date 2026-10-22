package com.luap.okpicker

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.view.WindowInsets
import android.widget.ScrollView
import android.widget.TextView

// First-run wizard: a list of steps, each with a status and a button, re-checked on resume.
class SetupActivity : Activity() {
    companion object {
        private fun prefs(c: Context) = c.getSharedPreferences("setup", Context.MODE_PRIVATE)
        fun done(context: Context): Boolean = prefs(context).getBoolean("done", false) && Settings.canDrawOverlays(context)

        private val BG = Color.parseColor("#444444")
        private val CARD = Color.parseColor("#535353")
        private val CARD_DONE = Color.parseColor("#494949") // done steps recede by background, not by a stripe
        private val TEXT = Color.parseColor("#dfdfdf")
        private val DIM = Color.parseColor("#b0b0b0")
        private val ACCENT = Color.parseColor("#9eabc9")
    }

    private class Step(val card: LinearLayout, val status: TextView, val action: View)

    private lateinit var overlay: Step
    private lateinit var notif: Step
    private lateinit var battery: Step
    private lateinit var usage: Step
    private lateinit var start: Button
    private val dp get() = resources.displayMetrics.density

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(20), px(24), px(20), px(24)) }
        col.addView(text("Set up OK Picker", 20f, TEXT))
        col.addView(text("A few things Android needs before the picker can float over Clip Studio.", 14f, DIM).apply { setPadding(0, px(4), 0, px(12)) })

        overlay = step(col, "Display over other apps", "Lets the picker sit on top of Clip Studio.",
            "Open setting" to { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }) { c ->
            c.addView(text("If the switch is greyed out: App info, then the three-dot menu, then Allow restricted settings (Samsung does this for apps installed outside the Play Store).", 13f, DIM))
            c.addView(button("Open App info") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) })
        }
        notif = step(col, "Notifications", "The notification shows the picker's status and has Show, Hide and Quit.",
            "Allow" to { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) }) {}
        battery = step(col, "Battery", "Stops Android from putting the picker to sleep while you paint.",
            "Allow" to { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }) { c ->
            c.addView(text("On Samsung also add OK Picker to Settings, Battery, Background usage limits, Never sleeping apps.", 13f, DIM))
            val i = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            if (i.resolveActivity(packageManager) != null) c.addView(button("Open battery settings") { startActivity(i) })
        }
        usage = step(col, "Show only over Clip Studio", "Usage access lets the picker see which app is in front: it hides over other apps and comes back when Clip Studio is open. It starts with the tablet.",
            "Open setting" to {
                val app = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))
                startActivity(if (app.resolveActivity(packageManager) != null) app else Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            }) { c ->
            c.addView(text("Find OK Picker in the list and turn it on. Without it the picker floats over every app until you hide it.", 13f, DIM))
        }
        val pair = card(CARD)
        pair.addView(text("Pair with Clip Studio", 16f, TEXT))
        pair.addView(text("Start the picker, open Clip Studio, choose Connect to smartphone (File menu or the ≡ menu), then tap the picker's square and Pair with CSP…", 14f, DIM).apply { setPadding(0, px(4), 0, 0) })
        col.addView(pair)

        start = Button(this).apply {
            text = "Start"
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            minHeight = px(48)
            setOnClickListener {
                prefs(this@SetupActivity).edit().putBoolean("done", true).apply()
                startForegroundService(Intent(this@SetupActivity, OverlayService::class.java).setAction(OverlayService.ACTION_SHOW))
                finish()
            }
        }
        // Start stays on screen below the scrolling steps (in landscape the steps fill the screen and pushed it off).
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
            addView(ScrollView(this@SetupActivity).apply { addView(col) }, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(start, LinearLayout.LayoutParams(-1, -2).apply { setMargins(px(20), px(4), px(20), px(12)) })
            // Android 15+ draws apps edge to edge: keep the title and Start clear of the status and navigation bars.
            setOnApplyWindowInsetsListener { v, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
                insets
            }
        })
    }

    override fun onResume() {
        super.onResume()
        mark(overlay, Settings.canDrawOverlays(this))
        mark(notif, checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        mark(battery, getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName))
        mark(usage, CspWatch.allowed(this))
        start.isEnabled = Settings.canDrawOverlays(this)
    }

    private fun mark(s: Step, ok: Boolean) {
        s.status.text = if (ok) "Done" else "To do"
        s.status.setTextColor(if (ok) ACCENT else TEXT)
        (s.card.background as GradientDrawable).setColor(if (ok) CARD_DONE else CARD)
        s.action.visibility = if (ok) View.GONE else View.VISIBLE
    }

    /** [extras] adds any further views to the card. */
    private fun step(parent: LinearLayout, title: String, blurb: String, main: Pair<String, () -> Unit>, extras: (LinearLayout) -> Unit): Step {
        val c = card(CARD)
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(text(title, 16f, TEXT), LinearLayout.LayoutParams(0, -2, 1f))
        val status = text("", 14f, TEXT)
        head.addView(status)
        c.addView(head)
        c.addView(text(blurb, 14f, DIM).apply { setPadding(0, px(4), 0, px(8)) })
        val action = button(main.first, main.second)
        c.addView(action)
        extras(c)
        parent.addView(c)
        return Step(c, status, action)
    }

    private fun card(color: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(px(16), px(14), px(16), px(14))
        background = GradientDrawable().apply { setColor(color); cornerRadius = px(8).toFloat() }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(12) }
    }

    private fun text(s: String, sp: Float, color: Int) = TextView(this).apply {
        text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); setTextColor(color)
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        minHeight = px(44)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(-2, -2)
    }

    private fun px(v: Int) = (v * dp).toInt()
}
