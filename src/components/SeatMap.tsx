import { Seat } from "./Seat"
import { SeatMapItem, UUID } from "@/types"

interface SeatMapProps {
    seats: SeatMapItem[]
    isLoading: boolean
    selectedSeatId: UUID | null
    onSelectSeat: (id: UUID) => void
}

export function SeatMap({ seats, isLoading, selectedSeatId, onSelectSeat }: SeatMapProps) {
    // Group seats by row for rendering
    const rows = Array.from(new Set(seats.map(s => s.rowName))).sort()

    if (isLoading) {
        return (
            <div className="w-full flex justify-center p-10 text-muted-foreground animate-pulse">
                Loading seat map...
            </div>
        )
    }

    if (seats.length === 0) {
        return (
            <div className="w-full flex justify-center p-10 text-muted-foreground">
                No seats found for this event.
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center gap-8 w-full max-w-3xl overflow-x-auto p-4">
            <div className="w-full bg-muted/30 h-12 rounded-lg flex items-center justify-center mb-8 border border-dashed border-muted-foreground/20 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent skew-x-12 opacity-50" />
                <span className="text-muted-foreground text-sm tracking-[0.3em] uppercase font-semibold">Stage</span>
            </div>

            <div className="flex flex-col gap-3">
                {rows.map(row => (
                    <div key={row} className="flex items-center gap-4">
                        <span className="w-6 text-sm font-medium text-muted-foreground text-center font-mono">
                            {row}
                        </span>
                        <div className="flex gap-2">
                            {seats
                                .filter(s => s.rowName === row)
                                .sort((a, b) => parseInt(a.seatNumber) - parseInt(b.seatNumber))
                                .map(seat => (
                                    <Seat
                                        key={seat.id}
                                        seat={seat}
                                        isSelected={selectedSeatId === seat.id}
                                        onSelect={(s) => onSelectSeat(s.id)}
                                    />
                                ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Legend */}
            <div className="flex gap-8 mt-8 text-xs text-muted-foreground bg-muted/20 px-6 py-3 rounded-full border">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-t-sm border bg-secondary" /> Available
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-t-sm border bg-primary border-primary" /> Selected
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-t-sm border bg-destructive/20 border-destructive/50" /> Taken
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-t-sm border bg-green-500/20 border-green-500/50" /> Yours
                </div>
            </div>
        </div>
    )
}
