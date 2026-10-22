package com.luap.okpicker

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.luap.cspremote.ColorState
import com.luap.cspremote.ConnectionState
import com.luap.cspremote.CspClient
import com.luap.cspremote.CspListener
import com.luap.cspremote.QrConfig
import com.luap.cspremote.Swatch
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt

// Holds the CSP connection and the two overlay windows: the dock icon and the picker panel,
// a WebView running the stage 1 bundle. Neither window takes focus, so CSP keeps the pen and the keyboard.
class OverlayService : Service(), CspListener {
    private lateinit var wm: WindowManager
    private lateinit var store: PairStore
    private val ui by lazy { getSharedPreferences("ui", MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())
    private val dp get() = resources.displayMetrics.density

    private lateinit var icon: View
    private lateinit var iconLp: WindowManager.LayoutParams
    private lateinit var panel: FrameLayout
    private lateinit var panelLp: WindowManager.LayoutParams
    private lateinit var web: WebView
    private var pageReady = false

    @Volatile private var client: CspClient? = null
    private var status = JSONObject().put("state", "unpaired")
    private var color: ColorState? = null
    private var spec: String? = null

    // display: "popup" hides on a tap outside, "tab" is Keep open. A dragged panel floats where it was dropped,
    // until it is dropped on the square.
    private var mode = "popup"
    private var floating = false
    private var minimized = false
    private var compact = false
    private var fitH = 0 // compact: the page's natural height, CSS px (= dp)
    private var hidden = false // Close: both windows away until Show
    private var panelOpen = false // the panel is out (the square always shows, when anything does)
    private var cspFront = true // Clip Studio is on screen; stays true without Usage access
    private var capturing = false // reading CSP's QR: nothing of ours on screen
    private var watch: CspWatch? = null
    private var outsideAt = 0L
    private var iconDownAt = 0L
    private var destroyed = false
    @Volatile private var altHeld = false

    // Title-bar drag and edge resize run on raw touch coordinates; the page only says which one started.
    private var gesture: String? = null
    private var touching = false // a finger is on the panel: a page "start" that arrives after its lift is dropped
    private var downX = 0f
    private var downY = 0f
    private var grabX = 0f // where the finger holds the panel, in the panel
    private var grabY = 0f
    private var startLp = IntArray(4)
    private var overIcon = false

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WindowManager::class.java)
        store = PairStore(this)
        mode = ui.getString("display", "popup")!!
        floating = ui.getBoolean("floating", false)
        compact = ui.getBoolean("compact", false)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "OK Picker", NotificationManager.IMPORTANCE_LOW))
        foreground(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
        buildIcon()
        buildPanel()
        wm.addView(icon, iconLp) // after the panel, so the square shows above a panel dragged onto it
        connect()
        panelOpen = mode == "tab" // started with the tablet: Keep open shows the panel, pop-up just the square
        startWatch()
        applyVisibility()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW -> if (::panel.isInitialized) { hidden = false; startWatch(); showPanel(true); notifyStatus() }
            ACTION_HIDE -> hideAll()
            ACTION_STOP -> stopSelf()
            ACTION_PAIRED -> connect()
            ACTION_PAIR_CAPTURE -> capture(intent.getIntExtra(EXTRA_CODE, 0), intent.getParcelableExtra(EXTRA_DATA, Intent::class.java))
        }
        return START_STICKY
    }

    override fun onDestroy() {
        destroyed = true
        watch?.stop()
        if (altHeld) client?.holdAlt(false)
        client?.close()
        main.removeCallbacksAndMessages(null)
        if (::panel.isInitialized) {
            runCatching { wm.removeViewImmediate(panel) }
            panel.removeAllViews()
            web.destroy()
        }
        if (::icon.isInitialized) runCatching { wm.removeViewImmediate(icon) }
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        placeIcon()
        placePanel()
    }

    // ---- CSP ----

    private fun connect() {
        client?.close()
        client = null
        if (!store.paired) { onConnection(ConnectionState.Unpaired); return }
        client = CspClient(store.ips, store.port, store.generation, store.qrPassword, store.savedPassword, this,
            pollMs = pollMs()).also { it.start() }
    }

    override fun onConnection(state: ConnectionState) = main.post {
        if (destroyed) return@post
        status = when (state) {
            ConnectionState.Unpaired -> JSONObject().put("state", "unpaired")
            ConnectionState.Connecting -> JSONObject().put("state", "connecting")
            ConnectionState.Connected -> JSONObject().put("state", "connected")
            is ConnectionState.Refused -> JSONObject().put("state", "unpaired").put("detail", "CSP refused: ${state.reason}. Pair again.")
            is ConnectionState.Disconnected -> JSONObject().put("state", "disconnected").put("detail", state.reason)
        }
        Log.i(TAG, "connection: $status")
        js("onStatus", status.toString())
        notifyStatus()
    }.let {}

    override fun onColor(state: ColorState) = main.post {
        if (destroyed) return@post
        color = state
        val c = Color.rgb(state.r, state.g, state.b)
        ((icon.background as LayerDrawable).getDrawable(1) as GradientDrawable).setColor(if (state.transparent) Color.TRANSPARENT else c)
        sendColor()
    }.let {}

    override fun onPasswordRotated(password: String) { store.saveRotated(password) }

    override fun onServerSpec(version: String) { spec = version }

    private fun sendColor() {
        val s = color ?: return
        js("onCspColor", JSONObject().put("r", s.r).put("g", s.g).put("b", s.b).put("index", s.index)
            .put("transparent", s.transparent).put("canSet", s.canSet).toString())
        val sub = s.sub.rgb()
        js("onSubColor", JSONObject().put("r", Color.red(sub)).put("g", Color.green(sub)).put("b", Color.blue(sub)).toString())
    }

    // ---- pairing: one frame of the screen while CSP shows its QR ----

    private fun capture(code: Int, data: Intent?) {
        if (data == null) return
        client?.close()
        client = null
        foreground(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        capturing = true // nothing of ours may cover the QR
        applyVisibility()
        main.postDelayed({
            QrCapture.capture(this, code, data) { url ->
                main.post {
                    if (destroyed) return@post
                    foreground(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                    capturing = false
                    if (hidden) applyVisibility() else showPanel(true)
                    val qr = url?.let { runCatching { QrConfig.parse(it) }.getOrNull() }
                    if (qr == null) {
                        js("onStatus", JSONObject().put("state", "unpaired")
                            .put("detail", "No CSP QR on screen. Open Connect to smartphone in CSP, then Pair.").toString())
                        connect()
                    } else {
                        store.saveQr(qr)
                        connect()
                    }
                }
            }
        }, 400) // let the consent dialog fade out first
    }

    // ---- windows ----

    private fun overlay(w: Int, h: Int) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }

    // Window coordinates start below the status bar (the overlay's parent frame), so this rect starts at 0,0.
    private val screen get() = wm.currentWindowMetrics.let { m ->
        val i = m.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        android.graphics.Rect(0, 0, m.bounds.width() - i.left - i.right, m.bounds.height() - i.top - i.bottom)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun buildIcon() {
        val u = dp
        val frame = GradientDrawable().apply { setColor(ICON_FRAME); cornerRadius = 4 * u; setStroke(u.roundToInt(), 0xFF252525.toInt()) }
        val swatch = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = 3 * u; setStroke(u.roundToInt(), 0xFFDFDFDF.toInt()) }
        icon = View(this).apply {
            background = LayerDrawable(arrayOf(frame, swatch)).apply { setLayerInset(1, (8 * u).toInt(), (8 * u).toInt(), (8 * u).toInt(), (8 * u).toInt()) }
            contentDescription = "OK Picker"
        }
        iconLp = overlay((40 * u).toInt(), (40 * u).toInt())
        placeIcon()
        // Drag it anywhere (an edge-only square felt stuck); dropped close to a side edge it docks there.
        // A tap shows or hides the panel.
        var sx = 0f; var sy = 0f; var ox = 0; var oy = 0; var moved = false
        icon.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { sx = e.rawX; sy = e.rawY; ox = iconLp.x; oy = iconLp.y; moved = false; iconDownAt = SystemClock.uptimeMillis() }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(e.rawX - sx) + abs(e.rawY - sy) > 10 * dp) moved = true
                    if (moved) { iconLp.x = ox + (e.rawX - sx).toInt(); iconLp.y = oy + (e.rawY - sy).toInt(); wm.updateViewLayout(icon, iconLp) }
                }
                MotionEvent.ACTION_UP -> if (moved) {
                    val s = screen
                    val snap = 24 * dp
                    val x = when {
                        iconLp.x - s.left < snap -> 0f
                        s.right - (iconLp.x + iconLp.width) < snap -> 1f
                        else -> (iconLp.x - s.left).toFloat() / (s.width() - iconLp.width)
                    }
                    ui.edit().putFloat("iconX", x).putFloat("iconY", (iconLp.y - s.top).toFloat() / (s.height() - iconLp.height)).apply()
                    placeIcon()
                    placePanel()
                } else if (outsideAt < iconDownAt - 50) { // else this press already closed it as an outside touch
                    showPanel(!panelOpen)
                }
            }
            true
        }
    }

    // Stored as fractions of the free range, so it keeps its place across rotation.
    private fun placeIcon() {
        val s = screen
        iconLp.x = (s.left + ui.getFloat("iconX", 1f) * (s.width() - iconLp.width)).roundToInt()
        iconLp.y = (s.top + ui.getFloat("iconY", 0.25f) * (s.height() - iconLp.height)).roundToInt()
        if (icon.isAttachedToWindow) wm.updateViewLayout(icon, iconLp)
    }

    // The panel opens on the side of the square with more room.
    private val panelLeftOfIcon get() = iconLp.x + iconLp.width / 2 > screen.centerX()

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun buildPanel() {
        // Debug builds: chrome://inspect over adb, for driving and profiling the panel on the tablet.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = makeWeb()
        panel = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            visibility = View.GONE
            setOnTouchListener { _, e ->
                if (e.actionMasked == MotionEvent.ACTION_OUTSIDE && mode == "popup" && !floating && gesture == null) {
                    outsideAt = SystemClock.uptimeMillis()
                    showPanel(false)
                }
                false
            }
        }
        panel.viewTreeObserver.addOnWindowFocusChangeListener { focused ->
            if (focused && panelLp.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE == 0) {
                val imm = getSystemService(InputMethodManager::class.java)
                imm.restartInput(web)
                @Suppress("DEPRECATION") imm.showSoftInput(web, InputMethodManager.SHOW_FORCED)
            } else if (!focused) {
                dropFocus() // the user went back to CSP: it gets its keys back
            }
        }
        panelLp = overlay(0, 0)
        placePanel()
        wm.addView(panel, panelLp)
    }

    private fun rebuildWeb() {
        pageReady = false
        panel.removeView(web)
        web.destroy()
        web = makeWeb()
        panel.addView(web, FrameLayout.LayoutParams(-1, -1))
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun makeWeb() = WebView(ContextThemeWrapper(this, android.R.style.Theme_Material)).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.textZoom = 100
            settings.setSupportZoom(false)
            overScrollMode = View.OVER_SCROLL_NEVER
            isLongClickable = false
            isHapticFeedbackEnabled = false
            setOnLongClickListener { true }
            setBackgroundColor(0xFF535353.toInt())
            addJavascriptInterface(Bridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    Log.w(TAG, "panel renderer gone (crash: ${detail.didCrash()}), rebuilding")
                    main.post { if (!destroyed) rebuildWeb() }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    // Text fields need a focusable window for the keyboard; everything else stays non-focusable.
                    view.evaluateJavascript("""
                        (function () {
                          const field = (t) => t && t.matches && t.matches('input, textarea, [contenteditable="true"]');
                          document.addEventListener('pointerdown', (e) => { if (field(e.target)) AndroidBridge.focus(true); }, true);
                          document.addEventListener('focusin', (e) => { if (field(e.target)) AndroidBridge.focus(true); });
                          document.addEventListener('focusout', (e) => { if (field(e.target)) AndroidBridge.focus(false); });
                          document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && field(e.target)) setTimeout(() => e.target.blur(), 0); });
                        })();
                    """.trimIndent(), null)
                }
            }
            setOnTouchListener { _, e -> drag(e); false }
            loadUrl("file:///android_asset/index.html")
        }

    // Anchored next to the icon, on the canvas side, unless it was dragged off to float.
    private fun placePanel() {
        val s = screen
        val gap = (4 * dp).toInt()
        panelLp.width = (if (compact) ui.getInt("compactW", 200) else ui.getInt("panelW", 320)).times(dp).toInt().coerceAtMost(s.width())
        // Compact follows its contents' height; the full panel keeps the height it was given.
        val fullH = ceil((if (compact && fitH > 0) fitH else ui.getInt("panelH", 640)) * dp).toInt().coerceAtMost(s.height()) // ceil: a px short shows a scrollbar
        panelLp.height = if (minimized) (34 * dp).toInt() else fullH
        if (floating) {
            panelLp.x = ui.getInt("floatX", s.left).coerceIn(s.left, s.right - panelLp.width)
            panelLp.y = ui.getInt("floatY", s.top).coerceIn(s.top, s.bottom - (34 * dp).toInt())
        } else {
            panelLp.x = if (panelLeftOfIcon) iconLp.x - gap - panelLp.width else iconLp.x + iconLp.width + gap
            panelLp.x = panelLp.x.coerceIn(s.left, s.right - panelLp.width)
            panelLp.y = iconLp.y.coerceIn(s.top, (s.bottom - panelLp.height).coerceAtLeast(s.top))
        }
        if (panel.isAttachedToWindow) wm.updateViewLayout(panel, panelLp)
        keepIconClear()
        sendLayout()
    }

    // The square keeps its place as a fraction of the screen, a floating panel in pixels, so after a rotation the
    // square could land under the panel, out of reach. It moves just beside it (until the next rotation).
    private fun keepIconClear() {
        if (!floating) return
        val p = android.graphics.Rect(panelLp.x, panelLp.y, panelLp.x + panelLp.width, panelLp.y + panelLp.height)
        if (!android.graphics.Rect.intersects(p, android.graphics.Rect(iconLp.x, iconLp.y, iconLp.x + iconLp.width, iconLp.y + iconLp.height))) return
        val s = screen
        val gap = (4 * dp).toInt()
        iconLp.x = if (p.right + gap + iconLp.width <= s.right) p.right + gap else (p.left - gap - iconLp.width).coerceAtLeast(s.left)
        if (icon.isAttachedToWindow) wm.updateViewLayout(icon, iconLp)
    }

    private fun sendLayout() {
        // The page puts its resize grips on the side away from the square.
        val dock = if (floating) "float" else if (panelLeftOfIcon) "right" else "left"
        js("onLayout", JSONObject().put("dock", dock).put("display", mode).put("minimized", minimized).toString())
    }

    private fun showPanel(show: Boolean) {
        if (hidden) return
        panelOpen = show
        gesture = null
        applyVisibility()
        if (show) placePanel()
    }

    private fun hideAll() {
        hidden = true
        applyVisibility()
        notifyStatus()
    }

    // What shows: nothing while Closed, while reading the QR, or while CSP isn't in front; else the square, and the panel if open.
    private fun applyVisibility() {
        val on = !hidden && cspFront && !capturing
        if (!(on && panelOpen)) dropFocus()
        icon.visibility = if (on) View.VISIBLE else View.GONE
        panel.visibility = if (on && panelOpen) View.VISIBLE else View.GONE
        client?.setPollInterval(pollMs())
    }

    private fun pollMs() = when {
        hidden || !cspFront -> POLL_AWAY
        panelOpen -> POLL_OPEN
        else -> POLL_HIDDEN
    }

    // With Usage access, the picker shows only while Clip Studio is in front (granted later: picked up on Show).
    private fun startWatch() {
        if (watch != null || !CspWatch.allowed(this)) return
        watch = CspWatch(this) { front ->
            cspFront = front
            applyVisibility()
            notifyStatus()
        }.also { it.start() }
    }

    // Raw-coordinate window moves for the page's title-bar drag and edge resize. A dragged panel stays exactly where
    // it is let go (it is kept on screen while it moves, so nothing jumps at the end); let go with the finger on the
    // square, which lights up, and it docks beside the square again.
    private fun drag(e: MotionEvent) {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touching = true
                gesture = null
                downX = e.rawX; downY = e.rawY; grabX = e.x; grabY = e.y
                startLp = intArrayOf(panelLp.x, panelLp.y, panelLp.width, panelLp.height)
            }
            MotionEvent.ACTION_MOVE -> follow(e)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                touching = false
                if (gesture != null) {
                    if (e.actionMasked == MotionEvent.ACTION_UP) follow(e) // the lift can land past the last move
                    if (gesture == "move" && floating && overIcon && e.actionMasked == MotionEvent.ACTION_UP) floating = false
                    lightIcon(false)
                    gesture = null
                    ui.edit().putBoolean("floating", floating).putInt("floatX", panelLp.x).putInt("floatY", panelLp.y)
                        .putInt(if (compact) "compactW" else "panelW", (panelLp.width / dp).roundToInt())
                        .apply { if (!minimized && !compact) putInt("panelH", (panelLp.height / dp).roundToInt()) }.apply()
                    placePanel()
                }
            }
        }
    }

    private fun follow(e: MotionEvent) {
        val g = gesture ?: return
        val dx = (e.rawX - downX).toInt()
        val dy = (e.rawY - downY).toInt()
        val (x0, y0, w0, h0) = startLp.toList()
        val minW = (260 * dp).toInt()
        val minH = (200 * dp).toInt()
        if (g == "move") {
            if (!floating && abs(dx) + abs(dy) < 12 * dp) return
            floating = true
            val s = screen
            panelLp.x = (x0 + dx).coerceIn(s.left, s.right - panelLp.width)
            panelLp.y = (y0 + dy).coerceIn(s.top, s.bottom - (34 * dp).toInt())
            lightIcon(onIcon(x0 + grabX + dx, y0 + grabY + dy))
        } else {
            if ("left" in g) { panelLp.width = (w0 - dx).coerceAtLeast(minW); panelLp.x = x0 + w0 - panelLp.width }
            if ("right" in g) panelLp.width = (w0 + dx).coerceAtLeast(minW)
            if ("bottom" in g) panelLp.height = (h0 + dy).coerceAtLeast(minH)
        }
        wm.updateViewLayout(panel, panelLp)
    }

    // The finger (in window coordinates) on the square, with a little room around it.
    private fun onIcon(x: Float, y: Float): Boolean {
        val m = 8 * dp
        return x >= iconLp.x - m && x <= iconLp.x + iconLp.width + m && y >= iconLp.y - m && y <= iconLp.y + iconLp.height + m
    }

    private fun lightIcon(on: Boolean) {
        if (on == overIcon) return
        overIcon = on
        ((icon.background as LayerDrawable).getDrawable(0) as GradientDrawable).setColor(if (on) ICON_LIT else ICON_FRAME)
    }

    private fun dropFocus() {
        if (panelLp.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0) return
        web.evaluateJavascript("document.activeElement && document.activeElement.blur()", null)
        setFocusable(false)
    }

    private fun setFocusable(on: Boolean) {
        val f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        if ((panelLp.flags and f == 0) == on) return
        panelLp.flags = if (on) panelLp.flags and f.inv() else panelLp.flags or f
        panelLp.softInputMode = if (on) WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE else WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
        wm.updateViewLayout(panel, panelLp)
        if (on) web.requestFocus() // the keyboard follows in the window-focus listener
    }

    private fun js(fn: String, arg: String) {
        if (pageReady) web.evaluateJavascript("window.cspPicker && cspPicker.$fn($arg)", null)
    }

    // ---- the page's calls (picker/README.md); they arrive on a WebView thread ----

    private inner class Bridge {
        @JavascriptInterface fun ready() = main.post {
            pageReady = true
            sendLayout()
            js("onStatus", status.toString())
            sendColor()
        }.let {}

        @JavascriptInterface fun setColor(r: Int, g: Int, b: Int) { client?.setColor(r, g, b) }

        @JavascriptInterface fun copy(text: String) = main.post {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("colour", text))
        }.let {}

        @JavascriptInterface fun frame(action: String) = main.post {
            when (action) {
                "close" -> hideAll()
                "minimize", "restore" -> { minimized = action == "minimize"; placePanel() }
                "compact:on", "compact:off" -> {
                    compact = action == "compact:on"
                    ui.edit().putBoolean("compact", compact).apply()
                    placePanel()
                }
                else -> if (action.startsWith("fit:")) {
                    fitH = action.removePrefix("fit:").toIntOrNull() ?: 0
                    if (compact) placePanel()
                }
            }
        }.let {}

        @JavascriptInterface fun dragTitle(phase: String, x: Double, y: Double) = main.post { if (phase == "start" && touching) gesture = "move" }.let {}

        @JavascriptInterface fun resize(edge: String, phase: String, x: Double, y: Double) = main.post { if (phase == "start" && touching) gesture = edge }.let {}

        @JavascriptInterface fun setDisplay(mode: String) = main.post {
            this@OverlayService.mode = mode
            ui.edit().putString("display", mode).apply()
            sendLayout()
        }.let {}

        @JavascriptInterface fun pair() = main.post {
            startActivity(Intent(this@OverlayService, PairActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.let {}

        @JavascriptInterface fun sendReport() = main.post {
            val c = client
            if (c != null) Report.share(this@OverlayService, c.log, spec, status.toString())
        }.let {}

        @JavascriptInterface fun focus(on: Boolean) = main.post { setFocusable(on) }.let {}

        // The panel's eyedropper: CSP's own, by holding Alt while the user taps the canvas.
        @JavascriptInterface fun eyedropper(on: Boolean) { altHeld = on; client?.holdAlt(on) }
    }

    // ---- notification ----

    private fun foreground(type: Int) = startForeground(1, notification(), type)

    private fun notification(): Notification {
        fun action(label: String, a: String) = Notification.Action.Builder(null, label,
            PendingIntent.getService(this, a.hashCode(), Intent(this, OverlayService::class.java).setAction(a), PendingIntent.FLAG_IMMUTABLE)).build()
        val state = status.optString("state")
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setContentTitle("OK Picker")
            .setContentText(if (!cspFront) "Shows when Clip Studio is in front" else when (state) { "connected" -> "Connected to Clip Studio"; "unpaired" -> "Not paired: tap the icon, then Pair"; else -> state.replaceFirstChar { it.uppercase() } })
            .setOngoing(true)
            .addAction(if (hidden) action("Show", ACTION_SHOW) else action("Hide", ACTION_HIDE))
            .addAction(action("Quit", ACTION_STOP))
            .build()
    }

    private fun notifyStatus() = getSystemService(NotificationManager::class.java).notify(1, notification())

    companion object {
        const val ACTION_SHOW = "com.luap.okpicker.SHOW"
        const val ACTION_HIDE = "com.luap.okpicker.HIDE"
        const val ACTION_STOP = "com.luap.okpicker.STOP"
        /** From PairActivity: the screen-capture consent, as [EXTRA_CODE] and [EXTRA_DATA]. */
        const val ACTION_PAIR_CAPTURE = "com.luap.okpicker.PAIR_CAPTURE"
        /** From PairActivity: PairStore already holds a QR read from a screenshot. */
        const val ACTION_PAIRED = "com.luap.okpicker.PAIRED"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL = "ok"
        // Idle poll intervals; while CSP's colour moves, cspremote polls every 30 ms anyway.
        private const val POLL_OPEN = 100L
        private const val POLL_HIDDEN = 500L
        private const val POLL_AWAY = 2000L // CSP not on screen
        private const val ICON_FRAME = 0xFF3D3D3D.toInt()
        private const val ICON_LIT = 0xFF75809A.toInt() // CSP's selected-item blue-grey: let go here to dock
        private const val TAG = "OkPicker"
    }
}

// CSP's main/sub swatches come as HLS or HSV (docs/PROTOCOL.md); the page wants bytes.
private fun Swatch.rgb(): Int {
    if (hsv) return Color.HSVToColor(floatArrayOf(h, x, y))
    val c = (1 - abs(2 * x - 1)) * y
    val hp = h / 60f
    val m = x - c / 2
    val k = c * (1 - abs(hp % 2 - 1))
    val (r, g, b) = when (hp.toInt()) {
        0 -> Triple(c, k, 0f); 1 -> Triple(k, c, 0f); 2 -> Triple(0f, c, k)
        3 -> Triple(0f, k, c); 4 -> Triple(k, 0f, c); else -> Triple(c, 0f, k)
    }
    return Color.rgb(((r + m) * 255).roundToInt(), ((g + m) * 255).roundToInt(), ((b + m) * 255).roundToInt())
}
