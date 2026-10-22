package com.luap.cspremote

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** A CSP stand-in behaving like CSP 5.1.4 (docs/PROTOCOL.md): one client at a time (the port closes while one is connected), never pushes state. */
class FakeCspHost(val qrPassword: String = "qrpass12", val generation: String = "G#1:2022.12") : AutoCloseable {
    private val first = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val port = first.localPort

    @Volatile var rgb = intArrayOf(10, 20, 30)
    @Volatile var index = 0
    @Volatile var transparent = false
    @Volatile var canSet = true
    @Volatile var manipulating = false
    @Volatile var hsv = false
    @Volatile var main = longArrayOf(0x80000000L, 0x40000000L, 0xFFFFFFFFL) // H, L, S (or H, S, V)
    @Volatile var sub = longArrayOf(0, 0, 0)
    /** Fail every login with this AuthErrorReason. */
    @Volatile var refuse: String? = null

    @Volatile private var password: String? = null
    @Volatile private var client: Socket? = null
    @Volatile private var alive = true
    val logins = CopyOnWriteArrayList<String>() // "fresh" or "reconnect"
    val colorsReceived = CopyOnWriteArrayList<List<Int>>()
    val acks = CopyOnWriteArrayList<Pair<String, Long>>()
    val commands = CopyOnWriteArrayList<String>()
    @Volatile var connected = false

    private val acceptor = thread(isDaemon = true, name = "fake-csp") {
        var ss: ServerSocket? = first
        while (alive) {
            val server = ss ?: bind() ?: continue
            ss = null
            val c = try { server.accept() } catch (e: Exception) { break }
            server.close() // CSP stops listening while a client is connected
            client = c
            connected = true
            try { serve(c) } catch (_: Exception) {}
            connected = false
            runCatching { c.close() }
        }
    }

    private fun bind(): ServerSocket? = try {
        ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port)) }
    } catch (e: Exception) { Thread.sleep(20); null }

    private val outLock = Any()
    private fun send(c: Socket, p: Packet) = synchronized(outLock) { c.getOutputStream().apply { write(p.encode()); flush() } }

    private fun serve(c: Socket) {
        val inp = BufferedInputStream(c.getInputStream())
        while (alive) {
            val p = Packet.read(inp)
            if (p.type == TYPE_OK) { acks += p.command to p.serial; continue }
            commands += p.command
            val (type, detail) = reply(p)
            send(c, Packet(type, p.command, p.serial, detail))
        }
    }

    private fun reply(p: Packet): Pair<Int, String> = when (p.command) {
        "Authenticate" -> authenticate(JSONArray(p.detail))
        "TellHeartbeat" -> TYPE_OK to ""
        "SetCurrentColor" -> {
            val d = JSONObject(p.detail)
            if (!canSet) TYPE_ERROR to ""
            else {
                rgb = intArrayOf(d.getInt("RGBColorR"), d.getInt("RGBColorG"), d.getInt("RGBColorB"))
                colorsReceived += rgb.toList()
                TYPE_OK to ""
            }
        }
        "SyncSubViewUIState" -> TYPE_OK to JSONObject()
            .put("CurrentColorRed", rgb[0] * 0x01010101L).put("CurrentColorGreen", rgb[1] * 0x01010101L).put("CurrentColorBlue", rgb[2] * 0x01010101L)
            .put("IsCurrentColorTransparent", transparent).put("CanExecuteSetterCommand", canSet).toString()
        "SyncColorCircleUIState" -> {
            val m = if (hsv) "HSV" else "HLS"
            val o = JSONObject().put("CurrentColorIndex", index).put("IsManipulating", manipulating).put("ColorSelectionModel", m)
                .put("CanExecuteSetterCommand", canSet)
            for ((who, v) in listOf("Main" to main, "Sub" to sub)) {
                o.put("${m}Color${who}H", v[0]).put("${m}Color${who}${if (hsv) "S" else "L"}", v[1]).put("${m}Color${who}${if (hsv) "V" else "S"}", v[2])
            }
            TYPE_OK to o.toString()
        }
        else -> TYPE_ERROR to ""
    }

    private fun authenticate(a: JSONArray): Pair<Int, String> {
        val first = authUnhex(a.getString(1))
        val second = authUnhex(a.getString(2))
        val reconnect = first == RECONNECT_MARKER
        logins += if (reconnect) "reconnect" else "fresh"
        val bad = refuse ?: when {
            a.getString(0) != generation -> "VersionMismatch"
            reconnect && second != password -> "PasswordMismatch"
            !reconnect && first != qrPassword -> "PasswordMismatch"
            else -> null
        }
        if (bad != null) return TYPE_ERROR to JSONObject().put("AuthErrorReason", bad).toString()
        if (!reconnect) password = second
        return TYPE_OK to JSONObject().put("AuthErrorReason", "Unknown").put("RemoteCommandSpecVersionOfServer", generation).toString()
    }

    /** The password the host expects for the next reconnect (set by the first login). */
    val rotatedPassword get() = password

    /** Host-initiated command (type 0x01); the client must ACK it. */
    fun push(command: String, detail: String = "{}", serial: Long = 900) {
        send(client!!, Packet(TYPE_COMMAND, command, serial, detail))
    }

    fun drop() { runCatching { client?.close() } }

    override fun close() {
        alive = false
        runCatching { client?.close() }
        runCatching { first.close() }
    }
}
