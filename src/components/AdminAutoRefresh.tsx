"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "./ui/button"
import { RefreshCw } from "lucide-react"

export function AdminAutoRefresh() {
    const router = useRouter()
    const [lastRefreshed, setLastRefreshed] = useState(new Date())
    const [isAutoRefreshing, setIsAutoRefreshing] = useState(true)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        if (!isAutoRefreshing) return

        // Connect to the global admin SSE channel
        const eventSource = new EventSource("/api/sse?eventId=admin")

        const handleUpdate = () => {
            console.log("[Admin] Real-time update received, refreshing data...")
            router.refresh()
            setLastRefreshed(new Date())
        }

        // Listen for ANY seat or booking events
        eventSource.addEventListener("seat.booked", handleUpdate)
        eventSource.addEventListener("seat.held", handleUpdate)
        eventSource.addEventListener("seat.released", handleUpdate)
        eventSource.addEventListener("seat.expired", handleUpdate)
        eventSource.addEventListener("connected", (e) => {
            console.log("[Admin] Real-time channel connected:", JSON.parse(e.data))
        })

        eventSource.onerror = (err) => {
            console.error("[Admin] SSE Connection lost, falling back to 30s polling", err)
            // Optional: fallback to slow poll if SSE fails
        }

        return () => {
            eventSource.close()
        }
    }, [router, isAutoRefreshing])

    return (
        <div className="flex items-center gap-4">
            <div className="text-xs text-muted-foreground tabular-nums">
                Updated: {mounted ? lastRefreshed.toLocaleTimeString() : "..."}
            </div>
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    router.refresh()
                    setLastRefreshed(new Date())
                }}
                className="gap-2"
            >
                <RefreshCw className={`h-3 w-3 ${isAutoRefreshing ? "animate-spin" : ""}`} />
                {isAutoRefreshing ? "Live" : "Refresh"}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAutoRefreshing(!isAutoRefreshing)}
                className="text-xs"
            >
                {isAutoRefreshing ? "Pause" : "Resume"}
            </Button>
        </div>
    )
}
