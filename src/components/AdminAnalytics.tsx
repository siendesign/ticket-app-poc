"use client"

import { useEffect, useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAnalyticsSummary } from "@/actions/admin"

interface AnalyticsData {
    totalRevenueCents: number
    occupancyRate: number
    bookedCount: number
    heldCount: number
    totalCount: number
    recentVelocityPerHour: number
}

interface AdminAnalyticsProps {
    initialData: AnalyticsData
}

export function AdminAnalytics({ initialData }: AdminAnalyticsProps) {
    const [data, setData] = useState<AnalyticsData>(initialData)
    const [isPending, startTransition] = useTransition()

    useEffect(() => {
        // Connect to the global admin SSE channel
        const eventSource = new EventSource("/api/sse?eventId=admin")

        const refreshAnalytics = async () => {
            console.log("[Analytics] Refreshing live metrics...")
            startTransition(async () => {
                const newData = await getAnalyticsSummary()
                setData(newData)
            })
        }

        // Listen for ANY seat or booking events that affect analytics
        eventSource.addEventListener("seat.booked", refreshAnalytics)
        eventSource.addEventListener("seat.held", refreshAnalytics)
        eventSource.addEventListener("seat.released", refreshAnalytics)
        eventSource.addEventListener("seat.expired", refreshAnalytics)

        return () => {
            eventSource.close()
        }
    }, [])

    return (
        <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-4 transition-opacity duration-500 ${isPending ? "opacity-70" : "opacity-100"}`}>
            <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">${(data.totalRevenueCents / 100).toFixed(2)}</div>
                    <p className="text-xs text-muted-foreground">Across all confirmed bookings</p>
                </CardContent>
                {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
            </Card>
            <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Occupancy Rate</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{data.occupancyRate.toFixed(1)}%</div>
                    <p className="text-xs text-muted-foreground">{data.bookedCount} of {data.totalCount} seats booked</p>
                </CardContent>
                {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
            </Card>
            <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Booking Velocity</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">+{data.recentVelocityPerHour}</div>
                    <p className="text-xs text-muted-foreground">Bookings in the last hour</p>
                </CardContent>
                {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
            </Card>
            <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Holds</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{data.heldCount}</div>
                    <p className="text-xs text-muted-foreground">Seats currently in checkout</p>
                </CardContent>
                {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
            </Card>
        </div>
    )
}
