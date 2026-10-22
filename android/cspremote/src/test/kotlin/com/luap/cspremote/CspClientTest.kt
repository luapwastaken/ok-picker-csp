package com.luap.cspremote

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

class CspClientTest {
    private val host = FakeCspHost()
    private val clients = mutableListOf<CspClient>()

    private class Rec : CspListener {
        val conn = CopyOnWriteArrayList<ConnectionState>()
        val colors = CopyOnWriteArrayList<ColorState>()
        @Volatile var password: String? = null
        @Volatile var spec: String? = null
        override fun onConnection(state: ConnectionState) { conn += state }
        override fun onColor(state: ColorState) { colors += state }
        override fun onPasswordRotated(password: String) { this.password = password }
        override fun onServerSpec(version: String) { spec = version }
    }

    @After fun tearDown() { clients.forEach { it.close() }; host.close() }

    private fun fresh(rec: Rec, poll: Long = 50, password: String = host.qrPassword) =
        CspClient(listOf("127.0.0.1"), host.port, host.generation, password, null, rec, poll).also { clients += it; it.start() }

    private fun saved(rec: Rec, pw: String, poll: Long = 50) =
        CspClient(listOf("127.0.0.1"), host.port, host.generation, null, pw, rec, poll).also { clients += it; it.start() }

    private fun await(what: String, ms: Long = 5000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (!cond()) {
            if (System.currentTimeMillis() > end) throw AssertionError("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    @Test fun qrDecode() {
        val q = QrConfig.parse("https://companion.clip-studio.com/rc/en-us?s=458ba0757a0fe85a83a2527913ea47879b1a2862be4580a16f4366f94588a06b7813f44580")
        assertEquals(listOf("192.0.2.10"), q.ips)
        assertEquals(32035, q.port)
        assertEquals("G#1:2022.12", q.generation)
        assertEquals(8, q.password.length)
    }

    @Test fun frameRoundTrip() {
        val p = Packet(TYPE_COMMAND, "SetCurrentColor", 42, """{"RGBColorR":1}""")
        val back = Packet.read(ByteArrayInputStream(p.encode()))
        assertEquals(listOf(TYPE_COMMAND, "SetCurrentColor", 42L, """{"RGBColorR":1}"""), listOf(back.type, back.command, back.serial, back.detail))
        val empty = Packet.read(ByteArrayInputStream(Packet(TYPE_OK, "TellHeartbeat", 0, "").encode()))
        assertEquals("", empty.detail)
        // a binary tail after 0B is dropped
        val tail = Packet(TYPE_OK, "X", 1, "{}\u000bBIN").encode()
        assertEquals("{}", Packet.read(ByteArrayInputStream(tail)).detail)
    }

    @Test fun loginRotatesPassword() {
        val rec = Rec()
        fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        assertEquals(listOf("fresh"), host.logins.toList())
        assertEquals(6 * 4 / 3, rec.password!!.length) // 6 bytes, base64 without padding
        assertFalse(rec.password!!.endsWith("="))
        assertEquals(host.rotatedPassword, rec.password)
        assertEquals(host.generation, rec.spec)
    }

    @Test fun reconnectsAfterDrop() {
        val rec = Rec()
        fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        host.drop()
        await("disconnect reported") { rec.conn.any { it is ConnectionState.Disconnected } }
        await("reconnected") { host.logins.size == 2 && rec.conn.last() == ConnectionState.Connected }
        assertEquals(listOf("fresh", "reconnect"), host.logins.toList())
    }

    @Test fun savedPasswordLogsInWithoutQr() {
        val a = Rec()
        val c1 = fresh(a)
        await("connected") { ConnectionState.Connected in a.conn }
        c1.close()
        await("host free") { !host.connected }
        val b = Rec()
        saved(b, a.password!!)
        await("connected again") { ConnectionState.Connected in b.conn }
        assertEquals(listOf("fresh", "reconnect"), host.logins.toList())
    }

    @Test fun unpairedWithoutCredentials() {
        val rec = Rec()
        CspClient(listOf("127.0.0.1"), host.port, host.generation, null, null, rec).also { clients += it; it.start() }
        assertEquals(listOf<ConnectionState>(ConnectionState.Unpaired), rec.conn.toList())
        assertTrue(host.logins.isEmpty())
    }

    @Test fun burstOfColorsLatestWins() {
        val rec = Rec()
        val c = fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        for (i in 0 until 300) c.setColor(i % 256, (i * 7) % 256, 128)
        await("last colour") { host.rgb.toList() == listOf(299 % 256, (299 * 7) % 256, 128) }
        assertTrue("sent ${host.colorsReceived.size}", host.colorsReceived.size <= 300)
        // frames carry no ColorSpaceKind / ColorIndex
        assertTrue(c.log.entries().filter { it.outgoing && it.command == "SetCurrentColor" }.none { "ColorSpaceKind" in it.detail || "ColorIndex" in it.detail })
    }

    @Test fun stateEmittedOnlyOnChangeWithScale() {
        host.rgb = intArrayOf(18, 52, 86)
        host.index = 1
        host.manipulating = true
        host.sub = longArrayOf(0xFFFFFFFFL, 0xFFFFFFFFL, 0)
        val rec = Rec()
        fresh(rec)
        await("first state") { rec.colors.size == 1 }
        val s = rec.colors[0]
        assertEquals(listOf(18, 52, 86, 1), listOf(s.r, s.g, s.b, s.index))
        assertTrue(s.manipulating && s.canSet && !s.transparent)
        assertEquals(Swatch(false, 180f, 0.25f, 1f), s.main.copy(h = Math.round(s.main.h).toFloat(), x = Math.round(s.main.x * 100) / 100f))
        assertEquals(Swatch(false, 360f, 1f, 0f), s.sub)
        Thread.sleep(400) // ~8 polls, no change
        assertEquals(1, rec.colors.size)
        host.rgb = intArrayOf(255, 255, 255)
        host.transparent = true
        host.index = -1
        await("second state") { rec.colors.size == 2 }
        assertEquals(listOf(255, 255, 255, -1), rec.colors[1].let { listOf(it.r, it.g, it.b, it.index) })
        assertTrue(rec.colors[1].transparent)
    }

    @Test fun hsvModelUsesHsvFields() {
        host.hsv = true
        host.main = longArrayOf(0x40000000L, 0xFFFFFFFFL, 0x80000000L)
        val rec = Rec()
        fresh(rec)
        await("state") { rec.colors.isNotEmpty() }
        val m = rec.colors[0].main
        assertTrue(m.hsv)
        assertEquals(90f, m.h, 0.1f)
        assertEquals(1f, m.x, 0.001f)
        assertEquals(0.5f, m.y, 0.001f)
    }

    @Test fun ackOfHostCommands() {
        val rec = Rec()
        fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        host.push("SomethingFromHost", serial = 77)
        await("ack") { ("SomethingFromHost" to 77L) in host.acks }
    }

    @Test fun refusedReasons() {
        for (reason in listOf("PasswordMismatch", "VersionMismatch")) {
            val h = FakeCspHost().also { it.refuse = reason }
            val rec = Rec()
            val c = CspClient(listOf("127.0.0.1"), h.port, h.generation, h.qrPassword, null, rec, 50)
            c.start()
            await("refused $reason") { ConnectionState.Refused(reason) in rec.conn }
            Thread.sleep(700) // permanent: no second attempt
            assertEquals(1, h.logins.size)
            c.close(); h.close()
        }
        host.refuse = "ServerUnready" // transient: retried
        val rec = Rec()
        fresh(rec)
        await("refused") { ConnectionState.Refused("ServerUnready") in rec.conn }
        await("retry") { host.logins.size >= 2 }
        host.refuse = null
        await("connected") { ConnectionState.Connected in rec.conn }
    }

    @Test fun wrongQrPasswordIsRefused() {
        val rec = Rec()
        fresh(rec, password = "wrongpw!")
        await("refused") { ConnectionState.Refused("PasswordMismatch") in rec.conn }
        assertEquals(null, rec.password)
    }

    @Test fun busyStateHoldsTheLatestColor() {
        host.canSet = false
        val rec = Rec()
        val c = fresh(rec)
        await("busy state") { rec.colors.lastOrNull()?.canSet == false }
        c.setColor(1, 2, 3)
        c.setColor(4, 5, 6)
        Thread.sleep(300)
        assertTrue(host.colorsReceived.isEmpty())
        host.canSet = true // the stroke ends: the held colour goes out without another setColor
        await("held colour sent") { host.rgb.toList() == listOf(4, 5, 6) }
        assertEquals(1, host.colorsReceived.size)
    }

    @Test fun hostAcceptsOneClientAtATime() {
        val rec = Rec()
        fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        val refused = try { Socket().use { it.connect(InetSocketAddress("127.0.0.1", host.port), 1000) }; false } catch (e: ConnectException) { true }
        assertTrue("second client should be refused", refused)
    }

    @Test fun logRedactsAuthenticate() {
        val rec = Rec()
        val c = fresh(rec)
        await("connected") { ConnectionState.Connected in rec.conn }
        val sent = c.log.entries().first { it.outgoing && it.command == "Authenticate" }
        assertEquals("[redacted]", sent.detail)
        assertFalse(c.log.text().contains(authHex(host.qrPassword)))
        assertNotNull(c.log.entries().firstOrNull { !it.outgoing && it.command == "Authenticate" })
    }
}
