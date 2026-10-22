package com.luap.cspremote

/** Ring buffer of packets for the app's Send report. Outgoing Authenticate details (passwords) are redacted. */
class PacketLog(private val capacity: Int = 2000) {
    data class Entry(val time: Long, val outgoing: Boolean, val type: Int, val command: String, val serial: Long, val detail: String) {
        override fun toString() = "$time ${if (outgoing) "->" else "<-"} 0x${type.toString(16)} $command #$serial $detail"
    }

    private val items = ArrayDeque<Entry>()

    @Synchronized
    internal fun add(outgoing: Boolean, p: Packet) {
        val d = if (outgoing && p.command == "Authenticate") "[redacted]" else p.detail.take(200)
        if (items.size >= capacity) items.removeFirst()
        items.addLast(Entry(System.currentTimeMillis(), outgoing, p.type, p.command, p.serial, d))
    }

    @Synchronized
    fun entries(): List<Entry> = items.toList()

    fun text(): String = entries().joinToString("\n")
}
