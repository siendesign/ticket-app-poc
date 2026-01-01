import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AdminAnalytics } from "@/components/AdminAnalytics"
import { getAdminData } from "@/actions/admin"
import { AdminAutoRefresh } from "@/components/AdminAutoRefresh"
import { AddEventDialog } from "@/components/AddEventDialog"
import { LineChart, RotateCcw } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { RefundButton } from "@/components/RefundButton"

// Helper to format dates
const formatDate = (date: string | Date | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleString()
}

export default async function AdminPage() {
    const data = await getAdminData()

    return (
        <main className="container mx-auto py-10 px-4">
            <div className="flex justify-between items-center mb-8">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
                    <p className="text-sm text-muted-foreground">Monitor system state in real-time</p>
                </div>
                <div className="flex items-center gap-4">
                    <AddEventDialog />
                    <AdminAutoRefresh />
                </div>
            </div>

            <Tabs defaultValue="analytics" className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-4">
                    <TabsTrigger value="analytics">Analytics</TabsTrigger>
                    <TabsTrigger value="bookings">Bookings ({data.bookings.length})</TabsTrigger>
                    <TabsTrigger value="seats">Seats ({data.seats.length})</TabsTrigger>
                    <TabsTrigger value="events">Events ({data.events.length})</TabsTrigger>
                    <TabsTrigger value="users">Users ({data.users.length})</TabsTrigger>
                </TabsList>

                {/* ANALYTICS TAB */}
                <TabsContent value="analytics" className="space-y-4">
                    <AdminAnalytics initialData={data.analytics} />
                </TabsContent>

                {/* BOOKINGS TAB */}
                <TabsContent value="bookings" className="bg-card rounded-lg border shadow-sm">
                    <div className="p-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Confirmation</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Seat ID</TableHead>
                                    <TableHead>Price</TableHead>
                                    <TableHead>Booked At</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.bookings.map((booking: any) => (
                                    <TableRow key={booking.id}>
                                        <TableCell className="font-medium font-mono">{booking.confirmationCode}</TableCell>
                                        <TableCell>
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${booking.paymentStatus === 'refunded' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' :
                                                    booking.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                                                        booking.status === 'cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                                                            'bg-gray-100 text-gray-800'
                                                }`}>
                                                {booking.paymentStatus === 'refunded' ? 'refunded' : booking.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{booking.userId}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{booking.seatId}</TableCell>
                                        <TableCell>${(booking.priceCents / 100).toFixed(2)}</TableCell>
                                        <TableCell className="text-xs">{formatDate(booking.bookedAt)}</TableCell>
                                        <TableCell className="text-right">
                                            <RefundButton bookingId={booking.id} status={booking.status} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {data.bookings.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center">No bookings found.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* SEATS TAB */}
                <TabsContent value="seats" className="bg-card rounded-lg border shadow-sm">
                    <div className="p-4 max-h-[600px] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Display Label</TableHead>
                                    <TableHead>Section</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Held By</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>Version</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.seats.map((seat: any) => (
                                    <TableRow key={seat.id}>
                                        <TableCell className="font-medium">{seat.displayLabel}</TableCell>
                                        <TableCell>{seat.section}</TableCell>
                                        <TableCell>
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${seat.status === 'available' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
                                                seat.status === 'booked' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                                                    seat.status === 'held' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                                                        'bg-gray-100 text-gray-800'
                                                }`}>
                                                {seat.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{seat.heldById || '-'}</TableCell>
                                        <TableCell className="text-xs">{formatDate(seat.holdExpiresAt)}</TableCell>
                                        <TableCell className="font-mono text-xs">{seat.version}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* EVENTS TAB */}
                <TabsContent value="events" className="bg-card rounded-lg border shadow-sm">
                    <div className="p-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Booking Opens</TableHead>
                                    <TableHead className="text-right">Dashboard</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.events.map((event: any) => (
                                    <TableRow key={event.id}>
                                        <TableCell className="font-medium">{event.name}</TableCell>
                                        <TableCell>
                                            <span className="capitalize px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">
                                                {event.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-xs">{formatDate(event.eventDate)}</TableCell>
                                        <TableCell className="text-xs">{formatDate(event.bookingOpens)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button asChild variant="ghost" size="sm" className="gap-2 h-8">
                                                <Link href={`/admin/events/${event.id}`}>
                                                    <LineChart className="w-4 h-4 text-primary" />
                                                    View Live
                                                </Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* USERS TAB */}
                <TabsContent value="users" className="bg-card rounded-lg border shadow-sm">
                    <div className="p-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Created At</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.users.map((user: any) => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">{user.fullName}</TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell>{user.status}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{user.id}</TableCell>
                                        <TableCell>{formatDate(user.createdAt)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>
            </Tabs>
        </main>
    )
}
