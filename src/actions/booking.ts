// ============================================================================
// SERVER ACTIONS FOR BOOKING
// ============================================================================
//
// These server actions are the ONLY entry point for booking mutations.
// They implement the single write path pattern:
//
// Client → Server Action → DB Transaction → Kafka Event → Broadcast
//
// Key responsibilities:
// 1. Authenticate the user
// 2. Validate input
// 3. Call repository functions (which do the real work in transactions)
// 4. Publish events to Kafka (after successful commit)
// 5. Return typed responses
//
// ============================================================================

'use server';

import { cookies } from 'next/headers';
import { bookSeat, holdSeat, releaseSeat, getSeatsByEventId } from '@/lib/db/seats';
import { publishBookingEvent } from '@/lib/kafka/producer';
import type {
  UUID,
  BookSeatRequest,
  BookSeatResponse,
  HoldSeatRequest,
  HoldSeatResponse,
  ReleaseSeatRequest,
  ReleaseSeatResponse,
  SeatMapItem,
} from '@/types';

// ----------------------------------------------------------------------------
// Authentication Helper
// ----------------------------------------------------------------------------

/**
 * Get current user from session
 *
 * In production, this would validate a JWT or session cookie.
 * For this example, we use a simple cookie-based approach.
 */
async function getCurrentUser(): Promise<{ id: UUID; email: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session');

  if (!sessionCookie) {
    return null;
  }

  try {
    // In production: verify JWT signature, check expiration, etc.
    const session = JSON.parse(sessionCookie.value);
    return {
      id: session.userId,
      email: session.email,
    };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// BOOK SEAT ACTION
// ----------------------------------------------------------------------------

/**
 * Book a seat for the current user
 *
 * This is the primary booking action. It:
 * 1. Validates authentication
 * 2. Calls the repository to perform the booking in a transaction
 * 3. On success, publishes a Kafka event for real-time propagation
 * 4. Returns a typed response for client handling
 *
 * @example
 * // Client-side usage
 * const response = await bookSeatAction({
 *   eventId: 'event-uuid',
 *   seatId: 'seat-uuid',
 *   optimisticId: 'client-generated-uuid',
 *   expectedVersion: 1, // From seat data the client has
 * });
 *
 * if (response.success) {
 *   // Booking confirmed! response.booking contains details
 * } else {
 *   // Handle error, rollback optimistic UI
 *   if (response.error?.code === 'SEAT_ALREADY_BOOKED') {
 *     showToast('This seat was just booked by someone else');
 *   }
 * }
 */
export async function bookSeatAction(
  request: BookSeatRequest
): Promise<BookSeatResponse> {
  // ========================================================================
  // Step 1: Authenticate
  // ========================================================================
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      error: {
        code: 'USER_NOT_AUTHENTICATED',
        message: 'You must be logged in to book a seat',
      },
    };
  }

  // ========================================================================
  // Step 2: Validate input
  // ========================================================================
  if (!request.eventId || !request.seatId) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Missing required fields',
      },
    };
  }

  if (typeof request.expectedVersion !== 'number' || request.expectedVersion < 1) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Invalid expected version',
      },
    };
  }

  // ========================================================================
  // Step 3: Execute booking in transaction
  // ========================================================================
  const result = await bookSeat(
    request.eventId,
    request.seatId,
    user.id,
    request.expectedVersion
  );

  // ========================================================================
  // Step 4: Handle result
  // ========================================================================
  if (!result.success) {
    // Booking failed - return error to client for rollback
    return {
      success: false,
      error: {
        code: result.code,
        message: result.message,
      },
    };
  }

  // ========================================================================
  // Step 5: Publish Kafka event (async, after successful commit)
  // ========================================================================
  // This is fire-and-forget with retry logic.
  // The booking is already committed - this is just for propagation.
  try {
    await publishBookingEvent({
      type: 'seat.booked',
      version: '1.0',
      timestamp: new Date().toISOString(),
      traceId: request.optimisticId,
      payload: {
        eventId: request.eventId,
        seatId: request.seatId,
        userId: user.id,
        previousStatus: 'available', // or 'held' if it was held
        newStatus: 'booked',
        bookingId: result.booking.id,
        metadata: {
          section: result.seat.section,
          rowName: result.seat.rowName,
          seatNumber: result.seat.seatNumber,
          displayLabel: result.seat.displayLabel,
          priceCents: result.booking.priceCents,
        },
      },
    });
  } catch (kafkaError) {
    // Log but don't fail - the booking is committed
    // A separate reconciliation process can detect missed events
    console.error('Failed to publish Kafka event:', kafkaError);
  }

  // ========================================================================
  // Step 6: Return success response
  // ========================================================================
  return {
    success: true,
    booking: result.booking,
    seat: {
      id: result.seat.id,
      displayLabel: result.seat.displayLabel,
      section: result.seat.section,
      rowName: result.seat.rowName,
      seatNumber: result.seat.seatNumber,
      category: result.seat.category,
      status: result.seat.status,
      priceCents: result.booking.priceCents,
      isOwnedByCurrentUser: true,
    },
  };
}

// ----------------------------------------------------------------------------
// HOLD SEAT ACTION
// ----------------------------------------------------------------------------

/**
 * Place a temporary hold on a seat
 *
 * Holds expire after 10 minutes and are released automatically.
 * Use this when a user selects a seat but hasn't completed checkout.
 */
export async function holdSeatAction(
  request: HoldSeatRequest
): Promise<HoldSeatResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      error: {
        code: 'USER_NOT_AUTHENTICATED',
        message: 'You must be logged in to hold a seat',
      },
    };
  }

  if (!request.eventId || !request.seatId) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Missing required fields',
      },
    };
  }

  const result = await holdSeat(
    request.eventId,
    request.seatId,
    user.id,
    request.expectedVersion
  );

  if (!result.success) {
    return {
      success: false,
      error: {
        code: result.code,
        message: result.message,
      },
    };
  }

  // Publish hold event
  try {
    await publishBookingEvent({
      type: 'seat.held',
      version: '1.0',
      timestamp: new Date().toISOString(),
      traceId: crypto.randomUUID(),
      payload: {
        eventId: request.eventId,
        seatId: request.seatId,
        userId: user.id,
        previousStatus: 'available',
        newStatus: 'held',
        metadata: {
          section: result.seat.section,
          rowName: result.seat.rowName,
          seatNumber: result.seat.seatNumber,
          displayLabel: result.seat.displayLabel,
        },
      },
    });
  } catch (kafkaError) {
    console.error('Failed to publish Kafka hold event:', kafkaError);
  }

  return {
    success: true,
    seat: {
      id: result.seat.id,
      displayLabel: result.seat.displayLabel,
      section: result.seat.section,
      rowName: result.seat.rowName,
      seatNumber: result.seat.seatNumber,
      category: result.seat.category,
      status: result.seat.status,
      priceCents: 0, // Not relevant for hold
      isOwnedByCurrentUser: true,
    },
    holdExpiresAt: result.holdExpiresAt,
  };
}

// ----------------------------------------------------------------------------
// RELEASE SEAT ACTION
// ----------------------------------------------------------------------------

/**
 * Release a held or booked seat
 *
 * For held seats: immediately releases back to available
 * For booked seats: cancels the booking and refunds (simplified here)
 */
export async function releaseSeatAction(
  request: ReleaseSeatRequest
): Promise<ReleaseSeatResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      error: {
        code: 'USER_NOT_AUTHENTICATED',
        message: 'You must be logged in to release a seat',
      },
    };
  }

  const result = await releaseSeat(request.seatId, user.id);

  if (!result.success) {
    return {
      success: false,
      error: {
        code: result.code,
        message: result.message,
      },
    };
  }

  // Publish release event
  try {
    await publishBookingEvent({
      type: 'seat.released',
      version: '1.0',
      timestamp: new Date().toISOString(),
      traceId: crypto.randomUUID(),
      payload: {
        eventId: request.eventId,
        seatId: request.seatId,
        userId: user.id,
        previousStatus: 'held', // Could be 'booked' for cancellations
        newStatus: 'available',
        metadata: {
          section: result.seat.section,
          rowName: result.seat.rowName,
          seatNumber: result.seat.seatNumber,
          displayLabel: result.seat.displayLabel,
        },
      },
    });
  } catch (kafkaError) {
    console.error('Failed to publish Kafka release event:', kafkaError);
  }

  return {
    success: true,
    seat: {
      id: result.seat.id,
      displayLabel: result.seat.displayLabel,
      section: result.seat.section,
      rowName: result.seat.rowName,
      seatNumber: result.seat.seatNumber,
      category: result.seat.category,
      status: result.seat.status,
      priceCents: 0,
      isOwnedByCurrentUser: false,
    },
  };
}

// ----------------------------------------------------------------------------
// GET SEATS ACTION (Read-only)
// ----------------------------------------------------------------------------

/**
 * Get all seats for an event
 *
 * This is a read operation that can use a read replica.
 * It's used for initial seat map rendering and periodic refresh.
 */
export async function getEventSeatsAction(
  eventId: UUID
): Promise<{ success: true; seats: SeatMapItem[] } | { success: false; error: string }> {
  const user = await getCurrentUser();

  try {
    const seats = await getSeatsByEventId(eventId, user?.id);
    return { success: true, seats };
  } catch (error) {
    console.error('Failed to get event seats:', error);
    return { success: false, error: 'Failed to load seats' };
  }
}
