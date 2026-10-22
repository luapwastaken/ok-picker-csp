package com.luap.okpicker

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.view.WindowManager
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.ChecksumException
import com.google.zxing.DecodeHintType
import com.google.zxing.FormatException
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

// Reads CSP's companion QR off the screen (docs/PROTOCOL.md). A failure says what the capture saw, so a pairing that
// doesn't work can be told apart: no picture, blank pictures, a QR that won't read, someone else's QR, or no QR.
object QrCapture {
    private const val PREFIX = "https://companion.clip-studio.com/rc/"
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))

    sealed interface Result {
        data class Found(val url: String) : Result
        data class Failed(val why: String) : Result
    }

    private sealed interface Seen {
        data class Csp(val url: String) : Seen
        data class Other(val text: String) : Seen
        data object Unreadable : Seen // a QR's finder patterns, but its data won't decode
        data object Nothing : Seen
    }

    /** Grabs frames until a CSP companion QR decodes or [timeoutMs] passes, stops the projection, then calls [done]
     *  on a background thread. The caller already runs a mediaProjection foreground service. */
    fun capture(context: Context, resultCode: Int, data: Intent, timeoutMs: Long = 3000, done: (Result) -> Unit) {
        val thread = HandlerThread("qr-capture").apply { start() }
        val handler = Handler(thread.looper)
        var finished = false
        var projection: MediaProjection? = null
        var display: VirtualDisplay? = null
        var reader: ImageReader? = null
        var frames = 0
        var blank = 0
        var unreadable = 0
        var other: String? = null
        var startError: String? = null
        var stopped = false
        var last: IntArray? = null
        var lastRow = 0
        val debug = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0

        fun why(): String = when {
            startError != null -> "the screen capture didn't start ($startError)"
            frames == 0 && stopped -> "Android stopped the screen capture before any picture arrived"
            frames == 0 -> "no picture came from the screen capture in ${timeoutMs / 1000} s"
            blank == frames -> "all $frames pictures of the screen were blank, so something is blocking screen capture"
            other != null -> "found a QR code, but not CSP's companion code (it reads \"${other!!.take(40)}\")"
            unreadable > 0 -> "a QR code is on screen but couldn't be read ($unreadable of $frames pictures). Make CSP's whole QR visible"
            else -> "no QR code in $frames pictures of the screen. Open Connect to smartphone in CSP so its QR shows, then tap Pair"
        }

        fun finish(url: String?) { // always on the handler thread, so no locking
            if (finished) return
            finished = true
            android.util.Log.i("OkPicker", "qr capture: $frames frames, $blank blank, $unreadable unreadable, ${if (url != null) "decoded" else "no QR"}")
            if (debug && url == null) last?.let { px -> // what the capture saw, for adb run-as cat cache/qr-last.png
                runCatching {
                    val bm = Bitmap.createBitmap(px, 0, lastRow, lastRow, px.size / lastRow, Bitmap.Config.ARGB_8888)
                    java.io.File(context.cacheDir, "qr-last.png").outputStream().use { bm.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
            }
            handler.removeCallbacksAndMessages(null)
            runCatching { display?.release() }
            runCatching { reader?.setOnImageAvailableListener(null, null); reader?.close() }
            runCatching { projection?.stop() }
            try { done(if (url != null) Result.Found(url) else Result.Failed(why())) } finally { thread.quitSafely() }
        }

        handler.post {
            try {
                val p: MediaProjection = context.getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)
                    ?: run { startError = "Android returned no projection"; return@post finish(null) }
                projection = p
                p.registerCallback(object : MediaProjection.Callback() { override fun onStop() { stopped = true; finish(null) } }, handler)
                val b = context.getSystemService(WindowManager::class.java).currentWindowMetrics.bounds
                val w = b.width()
                val h = b.height()
                val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
                reader = r
                r.setOnImageAvailableListener({ rd ->
                    val img = rd.acquireLatestImage() ?: return@setOnImageAvailableListener
                    val seen = try {
                        val pl = img.planes[0]
                        val rowPx = pl.rowStride / pl.pixelStride // pixels per row, including padding
                        val raw = IntArray(rowPx * h)
                        val buf = pl.buffer.order(java.nio.ByteOrder.nativeOrder()).asIntBuffer()
                        buf.get(raw, 0, minOf(raw.size, buf.remaining()))
                        // bytes are R,G,B,A (0xAABBGGRR as a little-endian int); swap R and B to ARGB
                        for (i in raw.indices) { val c = raw[i]; raw[i] = (c and 0xFF00FF00.toInt()) or ((c and 0xFF) shl 16) or ((c shr 16) and 0xFF) }
                        frames++
                        last = raw; lastRow = rowPx
                        if (isBlank(raw, rowPx, w, h)) { blank++; Seen.Nothing } else decodePixels(raw, rowPx, w, h)
                    } catch (e: Exception) { Seen.Nothing } finally { img.close() }
                    when (seen) {
                        is Seen.Csp -> finish(seen.url)
                        is Seen.Other -> other = seen.text
                        Seen.Unreadable -> unreadable++
                        Seen.Nothing -> {}
                    }
                }, handler)
                display = p.createVirtualDisplay("okpicker-qr", w, h, context.resources.displayMetrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
                handler.postDelayed({ finish(null) }, timeoutMs)
            } catch (e: Exception) {
                startError = "${e.javaClass.simpleName}: ${e.message}"
                finish(null)
            }
        }
    }

    /** The companion QR's URL in [bitmap] (the screenshot fallback), or why there is none. */
    fun decode(bitmap: Bitmap): Result {
        val src = if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap else bitmap.copy(Bitmap.Config.ARGB_8888, false)
        return when (val seen = decodePixels(pixels(src), src.width, src.width, src.height)) {
            is Seen.Csp -> Result.Found(seen.url)
            is Seen.Other -> Result.Failed("that picture has a QR code, but not CSP's companion code")
            Seen.Unreadable -> Result.Failed("that picture has a QR code that couldn't be read")
            Seen.Nothing -> Result.Failed("no QR code in that picture")
        }
    }

    /** one colour all over (black, or a blocked capture): sampled on a coarse grid */
    private fun isBlank(px: IntArray, rowPx: Int, w: Int, h: Int): Boolean {
        var lo = 255
        var hi = 0
        for (y in 0 until h step maxOf(1, h / 40)) for (x in 0 until w step maxOf(1, w / 60)) {
            val c = px[y * rowPx + x]
            val l = (((c shr 16) and 0xFF) * 3 + ((c shr 8) and 0xFF) * 6 + (c and 0xFF)) / 10
            if (l < lo) lo = l
            if (l > hi) hi = l
        }
        return hi - lo < 8
    }

    private fun pixels(bm: Bitmap) = IntArray(bm.width * bm.height).also { bm.getPixels(it, 0, bm.width, 0, 0, bm.width, bm.height) }

    /** [px] holds [rowPx] pixels per row, of which the first [w] are visible. */
    private fun decodePixels(px: IntArray, rowPx: Int, w: Int, h: Int): Seen {
        val full = read(RGBLuminanceSource(rowPx, h, px).let { if (rowPx == w) it else it.crop(0, 0, w, h) })
        if (full is Seen.Csp || full is Seen.Other) return full
        // At full size the tablet's 2560x1600 frames fail (ChecksumException: modules fall between pixels); half size reads.
        val half = Bitmap.createScaledBitmap(Bitmap.createBitmap(px, 0, rowPx, w, h, Bitmap.Config.ARGB_8888), w / 2, h / 2, true)
        val small = read(RGBLuminanceSource(half.width, half.height, pixels(half)))
        return when {
            small is Seen.Csp || small is Seen.Other -> small
            full == Seen.Unreadable || small == Seen.Unreadable -> Seen.Unreadable
            else -> Seen.Nothing
        }
    }

    private fun read(src: com.google.zxing.LuminanceSource): Seen = try {
        val text = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(src)), hints).text
        if (text.startsWith(PREFIX)) Seen.Csp(text) else Seen.Other(text)
    } catch (e: ChecksumException) {
        Seen.Unreadable
    } catch (e: FormatException) {
        Seen.Unreadable
    } catch (e: Exception) {
        Seen.Nothing // NotFoundException: no QR at all
    }
}
