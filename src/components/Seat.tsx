import { cn } from "@/lib/utils"
import { SeatMapItem, SeatStatus } from "@/types"
import { ComponentProps } from "react"

interface SeatProps extends Omit<ComponentProps<"button">, "onSelect"> {
    seat: SeatMapItem
    isSelected: boolean
    onSelect: (seat: SeatMapItem) => void
}

const statusColorMap: Record<SeatStatus, string> = {
    available: "bg-secondary hover:bg-primary hover:text-primary-foreground",
    held: "bg-yellow-500/20 text-yellow-500 border-yellow-500/50 cursor-not-allowed",
    booked: "bg-destructive/20 text-destructive border-destructive/50 cursor-not-allowed",
    blocked: "bg-muted text-muted-foreground cursor-not-allowed",
}

export function Seat({ seat, isSelected, onSelect, className, ...props }: SeatProps) {
    const isInteractable = seat.status === 'available' || (seat.status === 'held' && seat.isOwnedByCurrentUser)

    return (
        <button
            type="button"
            disabled={!isInteractable}
            onClick={() => onSelect(seat)}
            className={cn(
                "h-8 w-8 rounded-t-lg border-2 text-xs font-medium transition-all duration-200",
                "flex items-center justify-center",
                // status styles
                statusColorMap[seat.status],
                // selection styles (overrides status if selected)
                isSelected && "bg-primary text-primary-foreground border-primary scale-110",
                // user owned styles
                seat.isOwnedByCurrentUser && seat.status === 'booked' && "bg-green-500/20 text-green-500 border-green-500/50",
                className
            )}
            title={`${seat.displayLabel} - ${seat.status}`}
            {...props}
        >
            {seat.seatNumber}
        </button>
    )
}
