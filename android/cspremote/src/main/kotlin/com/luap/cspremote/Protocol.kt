package com.luap.cspremote

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream

// Wire format from clipremote 582daf2 and the probe against CSP 5.1.4 (docs/PROTOCOL.md).
internal const val TYPE_COMMAND = 0x01
internal const val TYPE_OK = 0x06
internal const val TYPE_ERROR = 0x15
internal const val RECONNECT_MARKER = "{{(([[reconnection request marker]]))}}\r\n"
private val AUTH_KEY = intArrayOf(0xB6, 0xD5, 0x92, 0xC4, 0xA7, 0x83, 0xE1)
private val QR_KEY = intArrayOf(0x74, 0xB2, 0x92, 0x5B, 0x4A, 0x21, 0xDA)

private fun xor(b: ByteArray, key: IntArray) = ByteArray(b.size) { (b[it].toInt() xor key[it % key.size]).toByte() }
private fun unhex(h: String) = h.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

internal fun authHex(s: String) = xor(s.toByteArray(), AUTH_KEY).joinToString("") { "%02x".format(it) }
internal fun authUnhex(h: String) = String(xor(unhex(h), AUTH_KEY))

/** What the pairing QR (`https://companion.clip-studio.com/rc/<lang>?s=<hex>`) carries. Image decoding is the app's job. */
data class QrConfig(val ips: List<String>, val port: Int, val password: String, val generation: String) {
    companion object {
        fun parse(url: String): QrConfig {
            val hex = Regex("[?&]s=([0-9a-fA-F]+)").find(url)?.groupValues?.get(1)
                ?: throw IllegalArgumentException("not a Companion Mode QR: no s= parameter")
            val f = String(xor(unhex(hex), QR_KEY)).split('\t')
            require(f.size >= 4) { "QR payload has ${f.size} fields, expected 4" }
            return QrConfig(f[0].split(',').map { it.trim() }.filter { it.isNotEmpty() }, f[1].trim().toInt(), f[2], f[3])
        }
    }
}

/** One frame: `<type>$tcp_remote_command_protocol_version=1.0 1E $command= 1E $serial= 1E $detail=<json> 1E 00`. */
class Packet(val type: Int, val command: String, val serial: Long, val detail: String) {
    fun encode(): ByteArray {
        val body = "\$tcp_remote_command_protocol_version=1.0\u001e\$command=$command\u001e\$serial=$serial\u001e\$detail=$detail\u001e"
        return byteArrayOf(type.toByte()) + body.toByteArray() + 0
    }

    companion object {
        private const val MAX_FRAME = 4 shl 20

        fun read(inp: InputStream): Packet {
            val buf = ByteArrayOutputStream()
            while (true) {
                val b = inp.read()
                if (b < 0) throw EOFException("connection closed")
                if (b == 0) break
                buf.write(b)
                if (buf.size() > MAX_FRAME) throw IOException("frame over $MAX_FRAME bytes")
            }
            val f = buf.toByteArray()
            if (f.isEmpty()) throw IOException("empty frame")
            val parts = String(f, 1, f.size - 1).removeSuffix("\u001e").split("\u001e\$", limit = 4)
            if (parts.size < 4) throw IOException("malformed frame")
            // A binary tail may follow the JSON after a 0B byte; it is not used here.
            return Packet(
                f[0].toInt() and 0xff, parts[1].removePrefix("command="),
                parts[2].removePrefix("serial=").toLongOrNull() ?: -1, parts[3].removePrefix("detail=").substringBefore('\u000b'),
            )
        }
    }
}
