package com.luap.okpicker

import android.content.Context
import com.luap.cspremote.QrConfig

// Pairing with CSP: the QR's addresses and generation, then the password the first login rotates in (docs/PROTOCOL.md).
class PairStore(context: Context) {
    private val p = context.getSharedPreferences("pair", Context.MODE_PRIVATE)

    val ips: List<String> get() = p.getString("ips", "")!!.split(',').filter { it.isNotEmpty() }
    val port: Int get() = p.getInt("port", 0)
    val generation: String get() = p.getString("gen", "")!!
    val qrPassword: String? get() = p.getString("qr", null) // spent by the first login
    val savedPassword: String? get() = p.getString("saved", null)
    val paired: Boolean get() = port != 0 && (qrPassword != null || savedPassword != null)

    fun saveQr(c: QrConfig) = p.edit()
        .putString("ips", c.ips.joinToString(",")).putInt("port", c.port).putString("gen", c.generation)
        .putString("qr", c.password).remove("saved").commit()

    fun saveRotated(password: String) = p.edit().putString("saved", password).remove("qr").commit()

    // For testing from the PC: an already-rotated password, as the probe leaves it.
    fun saveReconnect(ips: List<String>, port: Int, generation: String, password: String) = p.edit()
        .putString("ips", ips.joinToString(",")).putInt("port", port).putString("gen", generation)
        .putString("saved", password).remove("qr").commit()
}
