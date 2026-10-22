package com.luap.okpicker

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.ImageDecoder
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.widget.Toast
import com.luap.cspremote.QrConfig

// Asks for the one-frame screen capture; if refused, offers a screenshot of CSP's QR instead.
class PairActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (b != null) return // recreated while a dialog or picker was up
        val mpm = getSystemService(MediaProjectionManager::class.java)
        // API 34+ can be told to skip the app picker; 33 has only the plain intent
        val intent = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            else mpm.createScreenCaptureIntent()
        startActivityForResult(intent, REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        when (req) {
            REQ_CAPTURE ->
                if (res == RESULT_OK && data != null) {
                    startForegroundService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_PAIR_CAPTURE)
                        .putExtra(OverlayService.EXTRA_CODE, res).putExtra(OverlayService.EXTRA_DATA, data))
                    finish()
                } else AlertDialog.Builder(this).setMessage("Pick a screenshot of CSP's QR instead?")
                    .setPositiveButton("Pick") { _, _ -> startActivityForResult(Intent(MediaStore.ACTION_PICK_IMAGES), REQ_PICK) }
                    .setNegativeButton("Cancel") { _, _ -> finish() }
                    .setOnCancelListener { finish() }.show()
            REQ_PICK -> {
                val uri = data?.data
                val qr = if (res == RESULT_OK && uri != null) runCatching {
                    val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { d, _, _ ->
                        d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                    QrCapture.decode(bmp)?.let { QrConfig.parse(it) }
                }.getOrNull() else null
                if (qr != null) {
                    PairStore(this).saveQr(qr)
                    startService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_PAIRED))
                } else if (res == RESULT_OK) Toast.makeText(this, "No Clip Studio QR found in that picture", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    private companion object {
        const val REQ_CAPTURE = 1
        const val REQ_PICK = 2
    }
}
