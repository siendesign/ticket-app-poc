// ============================================================================
// SEAT REPOSITORY
// ============================================================================
//
// This module implements the SINGLE WRITE PATH for seat operations.
// All booking logic flows through here.
//
// Key principles:
// 1. All mutations happen in transactions
// 2. SELECT FOR UPDATE acquires row lock before any check
// 3. Optimistic locking (version column) prevents lost updates
// 4. Database constraints are the final authority
//
// ============================================================================

import {
  withTransaction,
  selectForUpdate,
  OptimisticLockError,
  TransactionContext,
} from './client';
import type {
  UUID,
  Seat,
  SeatMapItem,
  SeatStatus,
  Booking,
  BookingErrorCode,
} from '@/types';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface BookingResult {
  success: true;
  booking: Booking;
  seat: Seat;
}

export interface BookingError {
  success: false;
  code: BookingErrorCode;
  message: string;
  currentStatus?: SeatStatus;
  currentVersion?: number;
}

export type BookSeatResult = BookingResult | BookingError;

export interface HoldResult {
  success: true;
  seat: Seat;
  holdExpiresAt: Date;
}

export interface HoldError {
  success: false;
  code: BookingErrorCode;
  message: string;
  currentStatus?: SeatStatus;
  currentVersion?: number;
}

export type HoldSeatResult = HoldResult | HoldError;

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const HOLD_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// ----------------------------------------------------------------------------
// Seat Queries
// ----------------------------------------------------------------------------

/**
 * Get all seats for an event (for seat map rendering)
 */
export async function getSeatsByEventId(
  eventId: UUID,
  currentUserId?: UUID
): Promise<SeatMapItem[]> {
  const result = await withTransaction(async (tx) => {
    // First get base price from event
    const eventResult = await tx.query<{ base_price_cents: number }>(
      'SELECT base_price_cents FROM events WHERE id = $1',
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      return [];
    }

    const basePriceCents = eventResult.rows[0].base_price_cents;

    // Get all seats
    const seatsResult = await tx.query<{
      id: string;
      display_label: string;
      section: string;
      row_name: string;
      seat_number: string;
      category: string;
      status: SeatStatus;
      price_multiplier: number;
      held_by: string | null;
    }>(
      `SELECT id, display_label, section, row_name, seat_number,
              category, status, price_multiplier, held_by
       FROM seats
       WHERE event_id = $1
       ORDER BY section, row_name, seat_number`,
      [eventId]
    );

    return seatsResult.rows.map((row) => ({
      id: row.id,
      displayLabel: row.display_label,
      section: row.section,
      rowName: row.row_name,
      seatNumber: row.seat_number,
      category: row.category as SeatMapItem['category'],
      status: row.status,
      priceCents: Math.round(basePriceCents * row.price_multiplier),
      isOwnedByCurrentUser: currentUserId ? row.held_by === currentUserId : false,
    }));
  }, { readOnly: true });

  return result;
}

/**
 * Get a single seat with its current state
 */
export async function getSeatById(
  seatId: UUID,
  tx?: TransactionContext
): Promise<Seat | null> {
  const executor = tx
    ? tx.query.bind(tx)
    : async <T>(text: string, params?: unknown[]) => {
        const { query } = await import('./client');
        return query<T>(text, params);
      };

  const result = await executor<{
    id: string;
    event_id: string;
    section: string;
    row_name: string;
    seat_number: string;
    display_label: string;
    category: string;
    price_multiplier: number;
    status: SeatStatus;
    held_by: string | null;
    hold_expires_at: Date | null;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>('SELECT * FROM seats WHERE id = $1', [seatId]);

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    eventId: row.event_id,
    section: row.section,
    rowName: row.row_name,
    seatNumber: row.seat_number,
    displayLabel: row.display_label,
    category: row.category as Seat['category'],
    priceMultiplier: row.price_multiplier,
    status: row.status,
    heldBy: row.held_by,
    holdExpiresAt: row.hold_expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----------------------------------------------------------------------------
// CORE BOOKING LOGIC
// ----------------------------------------------------------------------------

/**
 * Book a seat - THE SINGLE WRITE PATH
 *
 * This function implements the complete booking flow:
 * 1. Acquire row lock on seat (SELECT ... FOR UPDATE)
 * 2. Validate seat is available or held by this user
 * 3. Check optimistic lock version
 * 4. Update seat status to 'booked'
 * 5. Create booking record
 * 6. Return result
 *
 * On failure at any step, the transaction rolls back automatically.
 *
 * @param eventId - The event ID
 * @param seatId - The seat to book
 * @param userId - The user making the booking
 * @param expectedVersion - Optimistic lock version (client must pass this)
 */
export async function bookSeat(
  eventId: UUID,
  seatId: UUID,
  userId: UUID,
  expectedVersion: number
): Promise<BookSeatResult> {
  try {
    return await withTransaction(async (tx) => {
      // ========================================================================
      // STEP 1: Acquire exclusive row lock on the seat
      // ========================================================================
      // This is CRITICAL - it serializes concurrent access to this seat
      // Any other transaction trying to book this seat will WAIT here
      const seat = await selectForUpdate<{
        id: string;
        event_id: string;
        section: string;
        row_name: string;
        seat_number: string;
        display_label: string;
        category: string;
        price_multiplier: number;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
      }>(tx, 'seats', seatId);

      if (!seat) {
        return {
          success: false,
          code: 'SEAT_NOT_FOUND' as BookingErrorCode,
          message: `Seat ${seatId} not found`,
        };
      }

      // Verify seat belongs to this event
      if (seat.event_id !== eventId) {
        return {
          success: false,
          code: 'SEAT_NOT_FOUND' as BookingErrorCode,
          message: 'Seat does not belong to this event',
        };
      }

      // ========================================================================
      // STEP 2: Check optimistic lock version
      // ========================================================================
      // This prevents lost updates when clients have stale data
      if (seat.version !== expectedVersion) {
        return {
          success: false,
          code: 'VERSION_CONFLICT' as BookingErrorCode,
          message: `Version conflict: expected ${expectedVersion}, got ${seat.version}`,
          currentStatus: seat.status,
          currentVersion: seat.version,
        };
      }

      // ========================================================================
      // STEP 3: Validate seat availability
      // ========================================================================
      const now = new Date();

      if (seat.status === 'booked') {
        return {
          success: false,
          code: 'SEAT_ALREADY_BOOKED' as BookingErrorCode,
          message: `Seat ${seat.display_label} is already booked`,
          currentStatus: seat.status,
          currentVersion: seat.version,
        };
      }

      if (seat.status === 'blocked') {
        return {
          success: false,
          code: 'SEAT_NOT_AVAILABLE' as BookingErrorCode,
          message: `Seat ${seat.display_label} is not available`,
          currentStatus: seat.status,
          currentVersion: seat.version,
        };
      }

      // If held, must be held by this user and not expired
      if (seat.status === 'held') {
        if (seat.held_by !== userId) {
          return {
            success: false,
            code: 'SEAT_ALREADY_HELD' as BookingErrorCode,
            message: `Seat ${seat.display_label} is held by another user`,
            currentStatus: seat.status,
            currentVersion: seat.version,
          };
        }

        // Check if hold has expired
        if (seat.hold_expires_at && seat.hold_expires_at < now) {
          return {
            success: false,
            code: 'HOLD_EXPIRED' as BookingErrorCode,
            message: 'Your hold on this seat has expired',
            currentStatus: 'available', // It's effectively available now
            currentVersion: seat.version,
          };
        }
      }

      // ========================================================================
      // STEP 4: Verify event is open for booking
      // ========================================================================
      const eventResult = await tx.query<{
        status: string;
        booking_opens: Date;
        booking_closes: Date;
        base_price_cents: number;
        currency: string;
      }>(
        `SELECT status, booking_opens, booking_closes, base_price_cents, currency
         FROM events WHERE id = $1`,
        [eventId]
      );

      const event = eventResult.rows[0];
      if (!event) {
        return {
          success: false,
          code: 'EVENT_NOT_FOUND' as BookingErrorCode,
          message: 'Event not found',
        };
      }

      if (event.status !== 'published') {
        return {
          success: false,
          code: 'EVENT_NOT_PUBLISHED' as BookingErrorCode,
          message: 'Event is not currently available for booking',
        };
      }

      if (now < event.booking_opens) {
        return {
          success: false,
          code: 'BOOKING_NOT_OPEN' as BookingErrorCode,
          message: `Booking opens at ${event.booking_opens.toISOString()}`,
        };
      }

      if (now > event.booking_closes) {
        return {
          success: false,
          code: 'BOOKING_CLOSED' as BookingErrorCode,
          message: 'Booking for this event has closed',
        };
      }

      // ========================================================================
      // STEP 5: Update seat status to 'booked'
      // ========================================================================
      // Increment version for optimistic locking
      const updateResult = await tx.query<{
        id: string;
        event_id: string;
        section: string;
        row_name: string;
        seat_number: string;
        display_label: string;
        category: string;
        price_multiplier: number;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE seats
         SET status = 'booked',
             held_by = $1,
             hold_expires_at = NULL,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $2 AND version = $3
         RETURNING *`,
        [userId, seatId, expectedVersion]
      );

      // This should never happen due to our FOR UPDATE lock, but just in case
      if (updateResult.rowCount === 0) {
        throw new OptimisticLockError('seats', seatId, expectedVersion);
      }

      const updatedSeat = updateResult.rows[0];

      // ========================================================================
      // STEP 6: Create booking record
      // ========================================================================
      const priceCents = Math.round(event.base_price_cents * seat.price_multiplier);

      const bookingResult = await tx.query<{
        id: string;
        seat_id: string;
        event_id: string;
        user_id: string;
        confirmation_code: string;
        price_cents: number;
        currency: string;
        payment_intent_id: string | null;
        payment_status: string;
        status: string;
        booked_at: Date;
        cancelled_at: Date | null;
        checked_in_at: Date | null;
        created_at: Date;
        updated_at: Date;
        version: number;
      }>(
        `INSERT INTO bookings (seat_id, event_id, user_id, price_cents, currency, payment_status)
         VALUES ($1, $2, $3, $4, $5, 'completed')
         RETURNING *`,
        [seatId, eventId, userId, priceCents, event.currency]
      );

      const booking = bookingResult.rows[0];

      // ========================================================================
      // STEP 7: Insert audit log entry
      // ========================================================================
      await tx.query(
        `INSERT INTO booking_audit_log
           (entity_type, entity_id, action, actor_id, actor_type, old_values, new_values)
         VALUES
           ('seat', $1, 'book', $2, 'user',
            $3::jsonb,
            $4::jsonb)`,
        [
          seatId,
          userId,
          JSON.stringify({ status: seat.status, version: seat.version }),
          JSON.stringify({
            status: 'booked',
            version: updatedSeat.version,
            bookingId: booking.id,
          }),
        ]
      );

      // ========================================================================
      // STEP 8: Return success
      // ========================================================================
      return {
        success: true as const,
        booking: {
          id: booking.id,
          seatId: booking.seat_id,
          eventId: booking.event_id,
          userId: booking.user_id,
          confirmationCode: booking.confirmation_code,
          priceCents: booking.price_cents,
          currency: booking.currency,
          paymentIntentId: booking.payment_intent_id,
          paymentStatus: booking.payment_status as Booking['paymentStatus'],
          status: booking.status as Booking['status'],
          bookedAt: booking.booked_at,
          cancelledAt: booking.cancelled_at,
          checkedInAt: booking.checked_in_at,
          createdAt: booking.created_at,
          updatedAt: booking.updated_at,
          version: booking.version,
        },
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.event_id,
          section: updatedSeat.section,
          rowName: updatedSeat.row_name,
          seatNumber: updatedSeat.seat_number,
          displayLabel: updatedSeat.display_label,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.price_multiplier,
          status: updatedSeat.status,
          heldBy: updatedSeat.held_by,
          holdExpiresAt: updatedSeat.hold_expires_at,
          version: updatedSeat.version,
          createdAt: updatedSeat.created_at,
          updatedAt: updatedSeat.updated_at,
        },
      };
    });
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return {
        success: false,
        code: 'VERSION_CONFLICT' as BookingErrorCode,
        message: error.message,
        currentVersion: error.actualVersion,
      };
    }
    console.error('Unexpected error in bookSeat:', error);
    return {
      success: false,
      code: 'INTERNAL_ERROR' as BookingErrorCode,
      message: 'An unexpected error occurred',
    };
  }
}

// ----------------------------------------------------------------------------
// HOLD SEAT (Temporary Reservation)
// ----------------------------------------------------------------------------

/**
 * Place a temporary hold on a seat
 *
 * Holds expire after HOLD_DURATION_MS and are cleaned up by a background job.
 */
export async function holdSeat(
  eventId: UUID,
  seatId: UUID,
  userId: UUID,
  expectedVersion: number
): Promise<HoldSeatResult> {
  try {
    return await withTransaction(async (tx) => {
      // Acquire row lock
      const seat = await selectForUpdate<{
        id: string;
        event_id: string;
        display_label: string;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
      }>(tx, 'seats', seatId);

      if (!seat) {
        return {
          success: false,
          code: 'SEAT_NOT_FOUND' as BookingErrorCode,
          message: 'Seat not found',
        };
      }

      if (seat.event_id !== eventId) {
        return {
          success: false,
          code: 'SEAT_NOT_FOUND' as BookingErrorCode,
          message: 'Seat does not belong to this event',
        };
      }

      // Check version
      if (seat.version !== expectedVersion) {
        return {
          success: false,
          code: 'VERSION_CONFLICT' as BookingErrorCode,
          message: `Version conflict: expected ${expectedVersion}, got ${seat.version}`,
          currentStatus: seat.status,
          currentVersion: seat.version,
        };
      }

      // Can only hold available seats
      if (seat.status !== 'available') {
        const errorMap: Record<SeatStatus, { code: BookingErrorCode; message: string }> = {
          held: {
            code: 'SEAT_ALREADY_HELD',
            message: `Seat ${seat.display_label} is already held`,
          },
          booked: {
            code: 'SEAT_ALREADY_BOOKED',
            message: `Seat ${seat.display_label} is already booked`,
          },
          blocked: {
            code: 'SEAT_NOT_AVAILABLE',
            message: `Seat ${seat.display_label} is not available`,
          },
          available: { code: 'INTERNAL_ERROR', message: '' }, // Won't happen
        };

        return {
          success: false,
          ...errorMap[seat.status],
          currentStatus: seat.status,
          currentVersion: seat.version,
        };
      }

      // Calculate hold expiration
      const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS);

      // Update seat
      const updateResult = await tx.query<{
        id: string;
        event_id: string;
        section: string;
        row_name: string;
        seat_number: string;
        display_label: string;
        category: string;
        price_multiplier: number;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE seats
         SET status = 'held',
             held_by = $1,
             hold_expires_at = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $3 AND version = $4
         RETURNING *`,
        [userId, holdExpiresAt, seatId, expectedVersion]
      );

      if (updateResult.rowCount === 0) {
        throw new OptimisticLockError('seats', seatId, expectedVersion);
      }

      const updatedSeat = updateResult.rows[0];

      // Audit log
      await tx.query(
        `INSERT INTO booking_audit_log
           (entity_type, entity_id, action, actor_id, actor_type, old_values, new_values)
         VALUES ('seat', $1, 'hold', $2, 'user', $3::jsonb, $4::jsonb)`,
        [
          seatId,
          userId,
          JSON.stringify({ status: seat.status, version: seat.version }),
          JSON.stringify({
            status: 'held',
            version: updatedSeat.version,
            holdExpiresAt: holdExpiresAt.toISOString(),
          }),
        ]
      );

      return {
        success: true as const,
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.event_id,
          section: updatedSeat.section,
          rowName: updatedSeat.row_name,
          seatNumber: updatedSeat.seat_number,
          displayLabel: updatedSeat.display_label,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.price_multiplier,
          status: updatedSeat.status,
          heldBy: updatedSeat.held_by,
          holdExpiresAt: updatedSeat.hold_expires_at,
          version: updatedSeat.version,
          createdAt: updatedSeat.created_at,
          updatedAt: updatedSeat.updated_at,
        },
        holdExpiresAt,
      };
    });
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return {
        success: false,
        code: 'VERSION_CONFLICT' as BookingErrorCode,
        message: error.message,
        currentVersion: error.actualVersion,
      };
    }
    console.error('Unexpected error in holdSeat:', error);
    return {
      success: false,
      code: 'INTERNAL_ERROR' as BookingErrorCode,
      message: 'An unexpected error occurred',
    };
  }
}

// ----------------------------------------------------------------------------
// RELEASE SEAT
// ----------------------------------------------------------------------------

/**
 * Release a held or booked seat back to available
 *
 * Only the holder/owner or an admin can release a seat.
 */
export async function releaseSeat(
  seatId: UUID,
  userId: UUID
): Promise<{ success: true; seat: Seat } | { success: false; code: BookingErrorCode; message: string }> {
  try {
    return await withTransaction(async (tx) => {
      const seat = await selectForUpdate<{
        id: string;
        event_id: string;
        section: string;
        row_name: string;
        seat_number: string;
        display_label: string;
        category: string;
        price_multiplier: number;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(tx, 'seats', seatId);

      if (!seat) {
        return {
          success: false as const,
          code: 'SEAT_NOT_FOUND' as BookingErrorCode,
          message: 'Seat not found',
        };
      }

      // Can only release if you're the holder
      if (seat.held_by !== userId) {
        return {
          success: false as const,
          code: 'SEAT_NOT_AVAILABLE' as BookingErrorCode,
          message: 'You do not own this seat',
        };
      }

      const updateResult = await tx.query<{
        id: string;
        event_id: string;
        section: string;
        row_name: string;
        seat_number: string;
        display_label: string;
        category: string;
        price_multiplier: number;
        status: SeatStatus;
        held_by: string | null;
        hold_expires_at: Date | null;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE seats
         SET status = 'available',
             held_by = NULL,
             hold_expires_at = NULL,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [seatId]
      );

      const updatedSeat = updateResult.rows[0];

      // If there was a booking, cancel it
      if (seat.status === 'booked') {
        await tx.query(
          `UPDATE bookings
           SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
           WHERE seat_id = $1 AND status = 'confirmed'`,
          [seatId]
        );
      }

      // Audit log
      await tx.query(
        `INSERT INTO booking_audit_log
           (entity_type, entity_id, action, actor_id, actor_type, old_values, new_values)
         VALUES ('seat', $1, 'release', $2, 'user', $3::jsonb, $4::jsonb)`,
        [
          seatId,
          userId,
          JSON.stringify({ status: seat.status, version: seat.version }),
          JSON.stringify({ status: 'available', version: updatedSeat.version }),
        ]
      );

      return {
        success: true as const,
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.event_id,
          section: updatedSeat.section,
          rowName: updatedSeat.row_name,
          seatNumber: updatedSeat.seat_number,
          displayLabel: updatedSeat.display_label,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.price_multiplier,
          status: updatedSeat.status,
          heldBy: updatedSeat.held_by,
          holdExpiresAt: updatedSeat.hold_expires_at,
          version: updatedSeat.version,
          createdAt: updatedSeat.created_at,
          updatedAt: updatedSeat.updated_at,
        },
      };
    });
  } catch (error) {
    console.error('Unexpected error in releaseSeat:', error);
    return {
      success: false,
      code: 'INTERNAL_ERROR' as BookingErrorCode,
      message: 'An unexpected error occurred',
    };
  }
}

// ----------------------------------------------------------------------------
// EXPIRE STALE HOLDS (Background Job)
// ----------------------------------------------------------------------------

/**
 * Expire all holds that have passed their expiration time
 *
 * This should be run periodically (e.g., every minute) by a background job.
 */
export async function expireStaleHolds(): Promise<{
  expiredCount: number;
  expiredSeatIds: UUID[];
}> {
  const result = await withTransaction(async (tx) => {
    const expiredResult = await tx.query<{ id: string; display_label: string }>(
      `UPDATE seats
       SET status = 'available',
           held_by = NULL,
           hold_expires_at = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE status = 'held'
         AND hold_expires_at < NOW()
       RETURNING id, display_label`
    );

    // Log all expirations
    for (const row of expiredResult.rows) {
      await tx.query(
        `INSERT INTO booking_audit_log
           (entity_type, entity_id, action, actor_type, new_values)
         VALUES ('seat', $1, 'expire_hold', 'system', $2::jsonb)`,
        [row.id, JSON.stringify({ status: 'available', reason: 'hold_expired' })]
      );
    }

    return {
      expiredCount: expiredResult.rowCount ?? 0,
      expiredSeatIds: expiredResult.rows.map((r) => r.id),
    };
  });

  return result;
}
