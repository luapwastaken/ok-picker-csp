package com.luap.okpicker

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import java.io.File

// Save colour set: Android's own Save dialog (Downloads unless the user picks elsewhere), so the file is on the tablet
// for CSP's Color Set palette, Import color set. The page's bytes wait in the cache until a place is chosen.
class SaveActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (b != null) return // recreated while the dialog was up
        val name = intent.getStringExtra(EXTRA_NAME) ?: return finish()
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(intent.getStringExtra(EXTRA_MIME) ?: "application/octet-stream").putExtra(Intent.EXTRA_TITLE, name), REQ)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        val src = File(intent.getStringExtra(EXTRA_PATH) ?: "")
        val uri = data?.data
        val said = when {
            res != RESULT_OK || uri == null -> null // cancelled: nothing to say
            !src.isFile -> "Not saved: the colour set was gone from the cache. Tap Save again."
            else -> runCatching {
                contentResolver.openOutputStream(uri, "wt")!!.use { out -> src.inputStream().use { it.copyTo(out) } }
                "Saved ${src.name}. In CSP: Color Set palette, Import color set."
            }.getOrElse { "Not saved (${it.javaClass.simpleName}: ${it.message})" }
        }
        said?.let { Toast.makeText(this, it, Toast.LENGTH_LONG).show() }
        finish()
    }

    companion object {
        const val EXTRA_NAME = "name"
        const val EXTRA_MIME = "mime"
        const val EXTRA_PATH = "path"
        private const val REQ = 1
    }
}
