// ============================================================================
// SEAT MAP HOOK - CLIENT STATE MANAGEMENT
// ============================================================================
//
// This hook manages the client-side state for the seat map, including:
// 1. Initial data fetching
// 2. Real-time updates via SSE
// 3. Optimistic updates with rollback
//
// Key principles:
// - CLIENT IS NEVER SOURCE OF TRUTH
// - Server response always wins
// - Optimistic updates are visual-only convenience
// - Every optimistic update has a rollback path
//
// ============================================================================

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  UUID,
  SeatMapItem,
  SeatStatus,
  OptimisticUpdate,
  RealtimeEvent,
  SeatStatusChangePayload,
  BookSeatResponse,
} from '@/types';
import { getEventSeatsAction, bookSeatAction } from '@/actions/booking';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface UseSeatMapOptions {
  eventId: UUID;
  onError?: (error: string) => void;
  onBookingSuccess?: (booking: BookSeatResponse) => void;
}

interface UseSeatMapReturn {
  // State
  seats: Map<UUID, SeatMapItem>;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;

  // Actions
  bookSeat: (seatId: UUID) => Promise<BookSeatResponse>;
  refreshSeats: () => Promise<void>;

  // Optimistic update info
  pendingUpdates: Map<string, OptimisticUpdate>;
}

// ----------------------------------------------------------------------------
// Hook Implementation
// ----------------------------------------------------------------------------

export function useSeatMap({
  eventId,
  onError,
  onBookingSuccess,
}: UseSeatMapOptions): UseSeatMapReturn {
  // ========================================================================
  // State
  // ========================================================================

  // Main seat data from server
  const [seats, setSeats] = useState<Map<UUID, SeatMapItem>>(new Map());

  // Loading and connection states
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optimistic updates queue
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, OptimisticUpdate>>(
    new Map()
  );

  // Refs for cleanup
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ========================================================================
  // Data Fetching
  // ========================================================================

  /**
   * Fetch seats from server (initial load and refresh)
   */
  const refreshSeats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await getEventSeatsAction(eventId);

      if (result.success) {
        const seatMap = new Map<UUID, SeatMapItem>();
        for (const seat of result.seats) {
          seatMap.set(seat.id, seat);
        }
        setSeats(seatMap);
      } else {
        setError(result.error);
        onError?.(result.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load seats';
      setError(message);
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  }, [eventId, onError]);

  // ========================================================================
  // SSE Connection
  // ========================================================================

  /**
   * Handle incoming SSE events
   */
  const handleSeatEvent = useCallback(
    (event: RealtimeEvent<SeatStatusChangePayload>) => {
      setSeats((prevSeats) => {
        const seat = prevSeats.get(event.payload.seatId);
        if (!seat) return prevSeats;

        // Create new map with updated seat
        const nextSeats = new Map(prevSeats);
        nextSeats.set(event.payload.seatId, {
          ...seat,
          status: event.payload.newStatus,
          // If this is our own action, we already handled it optimistically
          // But we update anyway to ensure consistency
          isOwnedByCurrentUser: event.payload.isCurrentUser ?? false,
        });

        return nextSeats;
      });

      // If this was our action, clear the pending update
      if (event.payload.isCurrentUser) {
        setPendingUpdates((prev) => {
          const next = new Map(prev);
          // Find and remove the pending update for this seat
          for (const [id, update] of next) {
            if (update.seatId === event.payload.seatId) {
              next.delete(id);
              break;
            }
          }
          return next;
        });
      }
    },
    []
  );

  /**
   * Set up SSE connection
   */
  useEffect(() => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const baseReconnectDelay = 1000;

    function connect() {
      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(`/api/sse?eventId=${eventId}`);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('connected', () => {
        console.log('SSE connected');
        setIsConnected(true);
        reconnectAttempts = 0;
      });

      eventSource.addEventListener('seat.booked', (e) => {
        const event: RealtimeEvent<SeatStatusChangePayload> = JSON.parse(e.data);
        handleSeatEvent(event);
      });

      eventSource.addEventListener('seat.held', (e) => {
        const event: RealtimeEvent<SeatStatusChangePayload> = JSON.parse(e.data);
        handleSeatEvent(event);
      });

      eventSource.addEventListener('seat.released', (e) => {
        const event: RealtimeEvent<SeatStatusChangePayload> = JSON.parse(e.data);
        handleSeatEvent(event);
      });

      eventSource.addEventListener('seat.expired', (e) => {
        const event: RealtimeEvent<SeatStatusChangePayload> = JSON.parse(e.data);
        handleSeatEvent(event);
      });

      eventSource.onerror = () => {
        console.error('SSE connection error');
        setIsConnected(false);
        eventSource.close();

        // Reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          setError('Lost connection to server. Please refresh the page.');
          onError?.('Connection lost');
        }
      };
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [eventId, handleSeatEvent, onError]);

  // ========================================================================
  // Initial Load
  // ========================================================================

  useEffect(() => {
    refreshSeats();
  }, [refreshSeats]);

  // ========================================================================
  // Booking Action with Optimistic Update
  // ========================================================================

  /**
   * Book a seat with optimistic update and rollback
   *
   * Flow:
   * 1. Generate optimisticId
   * 2. Store current state for rollback
   * 3. Apply optimistic update (seat -> pending)
   * 4. Call server action
   * 5a. Success: Server confirms, SSE broadcasts to others
   * 5b. Failure: Rollback to previous state, show error
   */
  const bookSeat = useCallback(
    async (seatId: UUID): Promise<BookSeatResponse> => {
      // Get current seat state
      const seat = seats.get(seatId);
      if (!seat) {
        return {
          success: false,
          error: { code: 'SEAT_NOT_FOUND', message: 'Seat not found' },
        };
      }

      // Can only book available seats (or our own held seats)
      if (seat.status !== 'available' && !seat.isOwnedByCurrentUser) {
        return {
          success: false,
          error: {
            code: 'SEAT_NOT_AVAILABLE',
            message: `Seat ${seat.displayLabel} is not available`,
          },
        };
      }

      // ====================================================================
      // Step 1: Generate optimistic ID
      // ====================================================================
      const optimisticId = crypto.randomUUID();

      // ====================================================================
      // Step 2: Store rollback state
      // ====================================================================
      const previousStatus = seat.status;

      const rollback = () => {
        setSeats((prev) => {
          const next = new Map(prev);
          const current = next.get(seatId);
          if (current) {
            next.set(seatId, { ...current, status: previousStatus });
          }
          return next;
        });
        setPendingUpdates((prev) => {
          const next = new Map(prev);
          next.delete(optimisticId);
          return next;
        });
      };

      // ====================================================================
      // Step 3: Apply optimistic update
      // ====================================================================
      const optimisticUpdate: OptimisticUpdate = {
        id: optimisticId,
        seatId,
        previousStatus,
        pendingStatus: 'booked',
        timestamp: Date.now(),
        rollback,
      };

      setPendingUpdates((prev) => new Map(prev).set(optimisticId, optimisticUpdate));

      // Update seat to show as "pending" (visual feedback)
      setSeats((prev) => {
        const next = new Map(prev);
        next.set(seatId, { ...seat, status: 'booked' });
        return next;
      });

      // ====================================================================
      // Step 4: Call server action
      // ====================================================================
      try {
        // We need to get the version from somewhere - in real impl, track it
        // For now, assume version tracking is handled
        const expectedVersion = 1; // TODO: Track actual version

        const response = await bookSeatAction({
          eventId,
          seatId,
          optimisticId,
          expectedVersion,
        });

        // ====================================================================
        // Step 5: Handle response
        // ====================================================================
        if (response.success) {
          // Success! Clear the pending update
          setPendingUpdates((prev) => {
            const next = new Map(prev);
            next.delete(optimisticId);
            return next;
          });

          // Update seat with confirmed data
          if (response.seat) {
            setSeats((prev) => {
              const next = new Map(prev);
              next.set(seatId, response.seat!);
              return next;
            });
          }

          onBookingSuccess?.(response);
        } else {
          // Failure - rollback
          rollback();
          onError?.(response.error?.message || 'Booking failed');
        }

        return response;
      } catch (err) {
        // Network error - rollback
        rollback();
        const message = err instanceof Error ? err.message : 'Booking failed';
        onError?.(message);

        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message },
        };
      }
    },
    [seats, eventId, onError, onBookingSuccess]
  );

  // ========================================================================
  // Return
  // ========================================================================

  return {
    seats,
    isLoading,
    isConnected,
    error,
    bookSeat,
    refreshSeats,
    pendingUpdates,
  };
}

// ----------------------------------------------------------------------------
// Additional Hooks
// ----------------------------------------------------------------------------

/**
 * Hook for tracking seat versions (optimistic locking)
 *
 * In production, you'd sync this with server state
 */
export function useSeatVersions(seats: Map<UUID, SeatMapItem>) {
  const [versions, setVersions] = useState<Map<UUID, number>>(new Map());

  useEffect(() => {
    // Initialize versions from seats (would come from server in real impl)
    const newVersions = new Map<UUID, number>();
    for (const [id] of seats) {
      if (!versions.has(id)) {
        newVersions.set(id, 1);
      } else {
        newVersions.set(id, versions.get(id)!);
      }
    }
    if (newVersions.size !== versions.size) {
      setVersions(newVersions);
    }
  }, [seats, versions]);

  const incrementVersion = useCallback((seatId: UUID) => {
    setVersions((prev) => {
      const next = new Map(prev);
      next.set(seatId, (prev.get(seatId) || 1) + 1);
      return next;
    });
  }, []);

  return { versions, incrementVersion };
}
