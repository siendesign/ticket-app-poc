import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "./ui/card"
import { Button } from "./ui/button"
import { SeatMapItem } from "@/types"
import { Loader2 } from "lucide-react"

interface BookingControlsProps {
    selectedSeat: SeatMapItem | null
    onBook: () => void
    isProcessing: boolean
}

export function BookingControls({ selectedSeat, onBook, isProcessing }: BookingControlsProps) {
    return (
        <Card className="sticky top-8 overflow-hidden border-muted">
            <CardHeader className="bg-muted/30 pb-4">
                <CardTitle>Ticket Details</CardTitle>
                <CardDescription>Review your selection before booking</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
                {selectedSeat ? (
                    <div className="space-y-6">
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</span>
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold">Row {selectedSeat.rowName}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-xl">Seat {selectedSeat.seatNumber}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">Section {selectedSeat.section}</p>
                        </div>

                        <div className="space-y-1 pt-4 border-t border-dashed">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Price</span>
                            <div className="flex items-baseline gap-1">
                                <span className="text-lg font-medium">$</span>
                                <span className="text-3xl font-bold">{(selectedSeat.priceCents / 100).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3 opacity-50">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-2xl">🎟️</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Select a seat from the map<br />to view details</p>
                    </div>
                )}
            </CardContent>
            <CardFooter className="bg-muted/10 pt-6">
                <Button
                    className="w-full text-lg h-12"
                    size="lg"
                    disabled={!selectedSeat || isProcessing || selectedSeat.status !== 'available'}
                    onClick={onBook}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Booking...
                        </>
                    ) : (
                        "Confirm Booking"
                    )}
                </Button>
            </CardFooter>
        </Card>
    )
}
