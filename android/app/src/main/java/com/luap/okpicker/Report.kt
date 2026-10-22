package com.luap.okpicker

import android.content.Context
import android.content.Intent
import android.os.Build
import com.luap.cspremote.PacketLog

// Send report: versions, status and the tail of the packet log, through the share sheet.
object Report {
    private const val CSP = "jp.co.celsys.clipstudiopaint.googleplay"

    fun share(context: Context, log: PacketLog?, spec: String?, status: String, events: List<String>) {
        val pm = context.packageManager
        val app = runCatching { pm.getPackageInfo(context.packageName, 0).versionName }.getOrNull()
        val csp = runCatching { pm.getPackageInfo(CSP, 0).versionName }.getOrNull() ?: "not installed"
        val text = listOf(
            "OK Picker $app",
            "Device: ${Build.MANUFACTURER} ${Build.MODEL}",
            "Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            "Clip Studio Paint: $csp",
            "Protocol spec: ${spec ?: "unknown"}",
            "Status: $status",
            "",
            "Log (last 400 lines):",
            "Pairing and connection (last ${events.size}):",
            events.joinToString("\n").ifEmpty { "none" },
            "",
            log?.text()?.lines()?.takeLast(400)?.joinToString("\n") ?: "(no connection, so no packets)",
        ).joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, "OK Picker report").putExtra(Intent.EXTRA_TEXT, text)
        context.startActivity(Intent.createChooser(send, "Send report").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
