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
import com.google.zxing.DecodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

// Reads CSP's companion QR off the screen (docs/PROTOCOL.md).
object QrCapture {
    private const val PREFIX = "https://companion.clip-studio.com/rc/"
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))

    /** Grabs frames until a CSP companion QR decodes or [timeoutMs] passes, stops the projection, then calls [done]
     *  on a background thread with the QR's URL, or null. The caller already runs a mediaProjection foreground service. */
    fun capture(context: Context, resultCode: Int, data: Intent, timeoutMs: Long = 3000, done: (String?) -> Unit) {
        val thread = HandlerThread("qr-capture").apply { start() }
        val handler = Handler(thread.looper)
        var finished = false
        var projection: MediaProjection? = null
        var display: VirtualDisplay? = null
        var reader: ImageReader? = null
        var frames = 0
        var last: IntArray? = null
        var lastRow = 0
        val debug = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0

        fun finish(url: String?) { // always on the handler thread, so no locking
            if (finished) return
            finished = true
            android.util.Log.i("OkPicker", "qr capture: ${frames} frames, ${if (url != null) "decoded" else "no QR"}")
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
            try { done(url) } finally { thread.quitSafely() }
        }

        handler.post {
            try {
                val p: MediaProjection = context.getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data) ?: return@post finish(null)
                projection = p
                p.registerCallback(object : MediaProjection.Callback() { override fun onStop() = finish(null) }, handler)
                val b = context.getSystemService(WindowManager::class.java).currentWindowMetrics.bounds
                val w = b.width()
                val h = b.height()
                val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
                reader = r
                r.setOnImageAvailableListener({ rd ->
                    val img = rd.acquireLatestImage() ?: return@setOnImageAvailableListener
                    val url = try {
                        val pl = img.planes[0]
                        val rowPx = pl.rowStride / pl.pixelStride // pixels per row, including padding
                        val raw = IntArray(rowPx * h)
                        val buf = pl.buffer.order(java.nio.ByteOrder.nativeOrder()).asIntBuffer()
                        buf.get(raw, 0, minOf(raw.size, buf.remaining()))
                        // bytes are R,G,B,A (0xAABBGGRR as a little-endian int); swap R and B to ARGB
                        for (i in raw.indices) { val c = raw[i]; raw[i] = (c and 0xFF00FF00.toInt()) or ((c and 0xFF) shl 16) or ((c shr 16) and 0xFF) }
                        frames++
                        last = raw; lastRow = rowPx
                        decodePixels(raw, rowPx, w, h)
                    } catch (e: Exception) { null } finally { img.close() }
                    if (url != null) finish(url)
                }, handler)
                display = p.createVirtualDisplay("okpicker-qr", w, h, context.resources.displayMetrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
                handler.postDelayed({ finish(null) }, timeoutMs)
            } catch (e: Exception) {
                finish(null)
            }
        }
    }

    /** The companion QR's URL in [bitmap] (the screenshot fallback), or null. */
    fun decode(bitmap: Bitmap): String? {
        val src = if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap else bitmap.copy(Bitmap.Config.ARGB_8888, false)
        return decodePixels(pixels(src), src.width, src.width, src.height)
    }

    private fun pixels(bm: Bitmap) = IntArray(bm.width * bm.height).also { bm.getPixels(it, 0, bm.width, 0, 0, bm.width, bm.height) }

    /** [px] holds [rowPx] pixels per row, of which the first [w] are visible. */
    private fun decodePixels(px: IntArray, rowPx: Int, w: Int, h: Int): String? {
        read(RGBLuminanceSource(rowPx, h, px).let { if (rowPx == w) it else it.crop(0, 0, w, h) })?.let { return it }
        // At full size the tablet's 2560x1600 frames fail (ChecksumException: modules fall between pixels); half size reads.
        val half = Bitmap.createScaledBitmap(Bitmap.createBitmap(px, 0, rowPx, w, h, Bitmap.Config.ARGB_8888), w / 2, h / 2, true)
        return read(RGBLuminanceSource(half.width, half.height, pixels(half)))
    }

    private fun read(src: com.google.zxing.LuminanceSource): String? {
        return try {
            QRCodeReader().decode(BinaryBitmap(HybridBinarizer(src)), hints).text.takeIf { it.startsWith(PREFIX) }
        } catch (e: Exception) { null } // not found / checksum / format
    }
}
