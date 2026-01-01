"use client"

import { useEffect, useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getEventAnalytics } from "@/actions/admin"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { RefundButton } from "@/components/RefundButton"

interface AnalyticsData {
    totalRevenueCents: number
    occupancyRate: number
    bookedCount: number
    heldCount: number
    totalCount: number
    recentVelocityPerHour: number
}

interface SingleEventAnalyticsProps {
    eventId: string
    initialData: {
        analytics: AnalyticsData
        recentBookings: any[]
    }
}

export function SingleEventAnalytics({ eventId, initialData }: SingleEventAnalyticsProps) {
    const [data, setData] = useState(initialData.analytics)
    const [bookings, setBookings] = useState(initialData.recentBookings)
    const [isPending, startTransition] = useTransition()

    useEffect(() => {
        // Connect to the specific event's SSE channel
        const eventSource = new EventSource(`/api/sse?eventId=${eventId}`)

        const refreshAnalytics = async () => {
            console.log(`[Event Analytics] Refreshing metrics for ${eventId}...`)
            startTransition(async () => {
                const result = await getEventAnalytics(eventId)
                setData(result.analytics)
                setBookings(result.recentBookings)
            })
        }

        // Listen for ANY seat or booking events for THIS event
        eventSource.addEventListener("seat.booked", refreshAnalytics)
        eventSource.addEventListener("seat.held", refreshAnalytics)
        eventSource.addEventListener("seat.released", refreshAnalytics)
        eventSource.addEventListener("seat.expired", refreshAnalytics)

        return () => {
            eventSource.close()
        }
    }, [eventId])

    return (
        <div className="space-y-8">
            <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-4 transition-opacity duration-500 ${isPending ? "opacity-70" : "opacity-100"}`}>
                <Card className="relative overflow-hidden border-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Event Revenue</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">${(data.totalRevenueCents / 100).toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">From confirmed bookings</p>
                    </CardContent>
                    {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
                </Card>
                <Card className="relative overflow-hidden border-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Occupancy</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.occupancyRate.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">{data.bookedCount} / {data.totalCount} seats</p>
                    </CardContent>
                    {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
                </Card>
                <Card className="relative overflow-hidden border-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Recent Bookings</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">+{data.recentVelocityPerHour}</div>
                        <p className="text-xs text-muted-foreground">In the last 60 minutes</p>
                    </CardContent>
                    {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
                </Card>
                <Card className="relative overflow-hidden border-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Current Holds</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.heldCount}</div>
                        <p className="text-xs text-muted-foreground">Seats in checkout pipe</p>
                    </CardContent>
                    {isPending && <div className="absolute bottom-0 left-0 h-1 bg-primary animate-pulse w-full" />}
                </Card>
            </div>

            <Card className="border-2 shadow-lg">
                <CardHeader>
                    <CardTitle className="text-xl font-bold">Live Activity Feed</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead>Customer</TableHead>
                                <TableHead>Seat</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                                <TableHead className="text-right">Time</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {bookings.length > 0 ? (
                                bookings.map((booking) => (
                                    <TableRow key={booking.id} className="hover:bg-muted/30 transition-colors">
                                        <TableCell className="font-medium">
                                            <div>{booking.user.fullName}</div>
                                            <div className="text-xs text-muted-foreground">{booking.user.email}</div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="px-2 py-1 bg-primary/10 rounded text-primary font-bold">{booking.seat.displayLabel}</span>
                                        </TableCell>
                                        <TableCell>${(booking.priceCents / 100).toFixed(2)}</TableCell>
                                        <TableCell>
                                            <span className={`capitalize px-2 py-1 rounded-full text-xs font-bold ring-1 ${booking.paymentStatus === 'refunded' ? 'bg-orange-500/10 text-orange-600 ring-orange-600/20' :
                                                booking.status === 'confirmed' ? 'bg-green-500/10 text-green-600 ring-green-600/20' :
                                                    booking.status === 'cancelled' ? 'bg-red-500/10 text-red-600 ring-red-600/20' :
                                                        'bg-gray-500/10 text-gray-600 ring-gray-600/20'
                                                }`}>
                                                {booking.paymentStatus === 'refunded' ? 'refunded' : booking.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <RefundButton bookingId={booking.id} status={booking.status} />
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {new Date(booking.createdAt).toLocaleTimeString()}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        No recent activity to show
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
