"use client"

import { SeatMap } from '@/components/SeatMap'
import { BookingControls } from '@/components/BookingControls'
import { useSeatMap } from '@/hooks/use-seat-map'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default function EventBookingPage() {
    const params = useParams()
    const eventId = params.id as string

    const {
        seats,
        isLoading,
        selectedSeatId,
        selectedSeat,
        isProcessing,
        setSelectedSeatId,
        handleBookSeat
    } = useSeatMap(eventId)

    return (
        <main className="flex min-h-screen flex-col items-center p-4 md:p-12 space-y-8 bg-background">
            <div className="w-full max-w-7xl">
                <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors gap-1 mb-6">
                    <ChevronLeft className="w-4 h-4" />
                    Back to Events
                </Link>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
                    <div className="space-y-2">
                        <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wider">SECURE BOOKING</span>
                        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">Select Your Seats</h1>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full items-start">
                    <div className="lg:col-span-8 space-y-4">
                        <div className="bg-card/50 backdrop-blur-sm rounded-2xl border-2 p-4 md:p-8 flex justify-center items-center min-h-[600px] shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                            <SeatMap
                                seats={seats}
                                isLoading={isLoading}
                                selectedSeatId={selectedSeatId}
                                onSelectSeat={setSelectedSeatId}
                            />
                        </div>
                    </div>

                    <div className="lg:col-span-4 sticky top-8">
                        <BookingControls
                            selectedSeat={selectedSeat}
                            onBook={handleBookSeat}
                            isProcessing={isProcessing}
                        />

                        <div className="mt-8 p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/10 rounded-2xl text-sm relative overflow-hidden group">
                            <div className="relative z-10">
                                <h4 className="font-bold text-foreground mb-2 flex items-center gap-2">
                                    <span className="text-lg">🛡️</span> Real-time Protection
                                </h4>
                                <p className="text-muted-foreground leading-relaxed">
                                    Our system uses database-level row locking to ensure that seats are reserved instantly and never double-booked.
                                </p>
                            </div>
                            <div className="absolute bottom-[-20px] right-[-20px] w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
                        </div>
                    </div>
                </div>
            </div>
        </main>
    )
}
