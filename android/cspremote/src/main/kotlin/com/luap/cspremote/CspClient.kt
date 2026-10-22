package com.luap.cspremote

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.LockSupport

sealed class ConnectionState {
    object Unpaired : ConnectionState()
    object Connecting : ConnectionState()
    object Connected : ConnectionState()

    /** CSP answered the login with an error. PasswordMismatch and VersionMismatch end the attempts; ServerUnready is retried. */
    data class Refused(val reason: String) : ConnectionState()
    data class Disconnected(val reason: String) : ConnectionState()
}

/** A colour from the colour circle. [hsv] false: x = L, y = S. [hsv] true: x = S, y = V. [h] is degrees, x and y are 0..1. */
data class Swatch(val hsv: Boolean, val h: Float, val x: Float, val y: Float)

data class ColorState(
    val r: Int, val g: Int, val b: Int, // the active colour, bytes
    val index: Int, // 0 main, 1 sub, -1 transparent
    val transparent: Boolean,
    val canSet: Boolean, // false mid-stroke and under modal dialogs: colours are held until it frees up
    val main: Swatch, val sub: Swatch,
    val manipulating: Boolean,
)

interface CspListener {
    /** All callbacks arrive on the library's thread. */
    fun onConnection(state: ConnectionState) {}
    fun onColor(state: ColorState) {}

    /** The password to save: pass it as [CspClient]'s `savedPassword` next time. */
    fun onPasswordRotated(password: String) {}
    fun onServerSpec(version: String) {}
}

/**
 * Companion Mode client. One worker thread does everything, strictly request/reply (CSP pushes nothing, docs/PROTOCOL.md).
 * Give it the QR [qrPassword] for a first pairing, or the [savedPassword] from [CspListener.onPasswordRotated] to reconnect.
 * With neither it reports Unpaired and does nothing. setColor, setPollInterval and close are safe from any thread.
 */
class CspClient(
    private val ips: List<String>,
    private val port: Int,
    private val generation: String,
    qrPassword: String?,
    savedPassword: String?,
    private val listener: CspListener,
    pollMs: Long = 250,
    val log: PacketLog = PacketLog(),
) {
    constructor(qr: QrConfig, listener: CspListener) : this(qr.ips, qr.port, qr.generation, qr.password, null, listener)

    private val qrPassword = qrPassword
    @Volatile private var saved = savedPassword
    @Volatile private var poll = pollMs
    @Volatile private var running = true
    @Volatile private var socket: Socket? = null
    @Volatile private var worker: Thread? = null
    private val wanted = AtomicReference<IntArray?>(null)
    private val altWanted = AtomicReference<Boolean?>(null)
    private var serial = 0L

    @Synchronized
    fun start() {
        if (worker != null) return
        if (qrPassword == null && saved == null) return listener.safe { onConnection(ConnectionState.Unpaired) }
        worker = Thread(::run, "cspremote").apply { isDaemon = true; start() }
    }

    /** One in flight, latest wins. */
    fun setColor(r: Int, g: Int, b: Int) {
        wanted.set(intArrayOf(r, g, b))
        LockSupport.unpark(worker)
    }

    /** Holds or releases Alt in CSP (DoModeChange). With a brush, CSP's default makes Alt its eyedropper. */
    fun holdAlt(down: Boolean) {
        altWanted.set(down)
        LockSupport.unpark(worker)
    }

    /** The idle interval: about 250 ms while the panel is open, slower otherwise. While the colour moves it polls every 30 ms. */
    fun setPollInterval(ms: Long) {
        poll = ms.coerceAtLeast(50)
        LockSupport.unpark(worker)
    }

    fun close() {
        running = false
        runCatching { socket?.close() }
        LockSupport.unpark(worker)
    }

    private fun run() {
        var backoff = BACKOFF_MIN
        while (running) {
            listener.safe { onConnection(ConnectionState.Connecting) }
            var up = false
            try {
                val s = connect()
                socket = s
                if (!running) { s.close(); return } // closed while connect() was blocking
                s.use {
                    s.soTimeout = 5000
                    s.tcpNoDelay = true
                    val io = Io(BufferedInputStream(s.getInputStream()), BufferedOutputStream(s.getOutputStream()))
                    serial = 0
                    val refused = login(io)
                    if (refused != null) {
                        listener.safe { onConnection(ConnectionState.Refused(refused)) }
                        if (refused != "ServerUnready") return
                    } else {
                        up = true
                        listener.safe { onConnection(ConnectionState.Connected) }
                        session(io)
                    }
                }
            } catch (e: Exception) {
                if (running) listener.safe { onConnection(ConnectionState.Disconnected(e.message ?: e.javaClass.simpleName)) }
            }
            if (up) backoff = BACKOFF_MIN
            if (running) {
                sleep(backoff)
                backoff = (backoff * 2).coerceAtMost(BACKOFF_MAX)
            }
        }
    }

    // CSP stops listening while a client is connected, and listens on 0.0.0.0, so loopback works too (2a).
    // Loopback first: on the same tablet it answers at once, while a QR address can be stale after a Wi-Fi change.
    private fun connect(): Socket {
        var err: Exception? = null
        for (host in (listOf("127.0.0.1") + ips).distinct()) {
            val s = Socket()
            try {
                s.connect(InetSocketAddress(host, port), 3000)
                return s
            } catch (e: Exception) {
                s.close()
                err = err ?: e
            }
        }
        throw err ?: ConnectException("no address to connect to")
    }

    /** Returns null on success, else the refusal reason. */
    private fun login(io: Io): String? {
        val reconnect = saved != null
        val next = if (reconnect) null else newPassword()
        val detail = if (reconnect) listOf(generation, authHex(RECONNECT_MARKER), authHex(saved!!))
        else listOf(generation, authHex(qrPassword!!), authHex(next!!))
        val r = io.request("Authenticate", JSONArray(detail).toString())
        val d = runCatching { JSONObject(r.detail) }.getOrNull()
        // Success is read from AuthErrorReason, not the type byte (docs/PROTOCOL.md).
        val reason = d?.optString("AuthErrorReason").orEmpty()
        if (reason in FAILS) return reason
        if (d == null && r.type == TYPE_ERROR) return "Error"
        d?.optString("RemoteCommandSpecVersionOfServer")?.takeIf { it.isNotEmpty() }?.let { v -> listener.safe { onServerSpec(v) } }
        if (next != null) {
            if (!running) return "Closed" // a closed client must not overwrite a newer pairing
            saved = next
            listener.safe { onPasswordRotated(next) }
        }
        return null
    }

    private fun session(io: Io) {
        var last: ColorState? = null
        var canSet = true
        var nextBeat = 0L
        var nextPoll = 0L
        var changedAt = 0L
        while (running) {
            // CSP refuses setters mid-stroke and under dialogs (canSet false): hold the latest colour until it frees up.
            if (canSet) wanted.getAndSet(null)?.let { c ->
                io.request(
                    "SetCurrentColor",
                    JSONObject().put("IsColorTransparent", false).put("RGBColorR", c[0]).put("RGBColorG", c[1]).put("RGBColorB", c[2]).toString(),
                )
            }
            altWanted.getAndSet(null)?.let { down ->
                io.request(
                    "DoModeChange",
                    JSONObject().put("FlagShift", false).put("FlagControl", false).put("FlagAlt", true)
                        .put("ProxyKeyboardEventKind", if (down) "KeyDown" else "KeyUp").toString(),
                )
            }
            val now = ms()
            if (now >= nextBeat) { io.request("TellHeartbeat", ""); nextBeat = now + 1000 }
            if (now >= nextPoll) {
                readState(io)?.let { st ->
                    canSet = st.canSet
                    if (st != last) { last = st; changedAt = now; listener.safe { onColor(st) } }
                }
                // CSP pushes nothing (docs/PROTOCOL.md), so a drag on CSP's own wheel is only seen by polling:
                // poll fast while the colour is moving, and at the set interval once it settles.
                nextPoll = now + if (now - changedAt < BURST_MS) FAST_POLL_MS else poll
            }
            if ((wanted.get() == null || !canSet) && altWanted.get() == null) LockSupport.parkNanos((minOf(nextBeat, nextPoll) - ms()).coerceAtLeast(1) * 1_000_000)
        }
    }

    private fun readState(io: Io): ColorState? {
        val sub = io.request("SyncSubViewUIState", "")
        val circle = io.request("SyncColorCircleUIState", "")
        if (sub.type != TYPE_OK || circle.type != TYPE_OK) return null
        val s = JSONObject(sub.detail)
        val c = JSONObject(circle.detail)
        val byte = { k: String -> Math.round(s.optLong(k) / SCALE_BYTE).toInt() } // byte x 0x01010101 (docs/PROTOCOL.md)
        val unit = { k: String -> (c.optLong(k) / SCALE_FULL).toFloat() }
        val hsv = c.optString("ColorSelectionModel") == "HSV"
        val sw = { who: String ->
            if (hsv) Swatch(true, unit("HSVColor${who}H") * 360f, unit("HSVColor${who}S"), unit("HSVColor${who}V"))
            else Swatch(false, unit("HLSColor${who}H") * 360f, unit("HLSColor${who}L"), unit("HLSColor${who}S"))
        }
        return ColorState(
            byte("CurrentColorRed"), byte("CurrentColorGreen"), byte("CurrentColorBlue"),
            c.optInt("CurrentColorIndex"), s.optBoolean("IsCurrentColorTransparent") || c.optBoolean("IsCurrentColorTransparent"),
            s.optBoolean("CanExecuteSetterCommand", true) && c.optBoolean("CanExecuteSetterCommand", true),
            sw("Main"), sw("Sub"), c.optBoolean("IsManipulating"),
        )
    }

    private inner class Io(val inp: BufferedInputStream, val out: BufferedOutputStream) {
        fun write(p: Packet) {
            log.add(true, p)
            out.write(p.encode())
            out.flush()
        }

        fun request(command: String, detail: String): Packet {
            val s = serial++
            write(Packet(TYPE_COMMAND, command, s, detail))
            while (true) {
                val p = Packet.read(inp).also { log.add(false, it) }
                // CSP waits for an ACK (same command and serial, empty detail) on every command it starts.
                if (p.type == TYPE_COMMAND) write(Packet(TYPE_OK, p.command, p.serial, "")) else if (p.serial == s) return p
            }
        }
    }

    private fun sleep(d: Long) {
        val end = ms() + d
        while (running && ms() < end) Thread.sleep(20)
    }

    private fun ms() = System.nanoTime() / 1_000_000

    private fun CspListener.safe(f: CspListener.() -> Unit) { runCatching { f() } }

    private companion object {
        val FAILS = setOf("VersionMismatch", "PasswordMismatch", "ServerUnready")
        const val FAST_POLL_MS = 30L
        const val BURST_MS = 1500L
        const val BACKOFF_MIN = 300L
        const val BACKOFF_MAX = 5000L
        const val SCALE_BYTE = 0x01010101.toDouble()
        const val SCALE_FULL = 0xFFFFFFFFL.toDouble()
        fun newPassword(): String = Base64.getEncoder().withoutPadding().encodeToString(ByteArray(6).also { SecureRandom().nextBytes(it) })
    }
}
