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

import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import type {
  UUID,
  Seat,
  SeatMapItem,
  SeatStatus,
  Booking,
  BookingErrorCode,
} from '@/types';

// Extend Seat Status to match Prisma/Types
type InternalSeatStatus = SeatStatus;

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

/**
 * Generate a human-readable confirmation code
 * Format: TKT-XXXXXX (6 alphanumeric characters)
 */
function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TKT-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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
  // Use a transaction even for read-only to ensure consistency between event and seats
  return await prisma.$transaction(async (tx: any) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { basePriceCents: true }
    });

    if (!event) return [];

    const seats = await tx.seat.findMany({
      where: { eventId },
      orderBy: [
        { section: 'asc' },
        { rowName: 'asc' },
        { seatNumber: 'asc' }
      ]
    });

    return seats.map((seat: any) => ({
      id: seat.id,
      displayLabel: seat.displayLabel,
      section: seat.section,
      rowName: seat.rowName,
      seatNumber: seat.seatNumber,
      category: seat.category as SeatMapItem['category'],
      status: seat.status as SeatStatus,
      priceCents: Math.round(event.basePriceCents * seat.priceMultiplier.toNumber()),
      isOwnedByCurrentUser: currentUserId ? seat.heldById === currentUserId : false,
    }));
  });
}

/**
 * Get a single seat with its current state
 */
export async function getSeatById(
  seatId: UUID,
  tx?: any // Using any to allow Prisma Transaction Client
): Promise<Seat | null> {
  const client = tx || prisma;

  const seat = await client.seat.findUnique({
    where: { id: seatId }
  });

  if (!seat) return null;

  return {
    id: seat.id,
    eventId: seat.eventId,
    section: seat.section,
    rowName: seat.rowName,
    seatNumber: seat.seatNumber,
    displayLabel: seat.displayLabel,
    category: seat.category as Seat['category'],
    priceMultiplier: seat.priceMultiplier.toNumber(),
    status: seat.status as SeatStatus,
    heldBy: seat.heldById,
    holdExpiresAt: seat.holdExpiresAt,
    version: seat.version,
    createdAt: seat.createdAt,
    updatedAt: seat.updatedAt,
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
    return await prisma.$transaction(async (tx: any) => {
      // ========================================================================
      // STEP 1: Acquire exclusive row lock on the seat
      // ========================================================================
      // Using tagged template for FOR UPDATE lock
      const seats = await tx.$queryRaw<any[]>`SELECT * FROM seats WHERE id = ${seatId}::uuid FOR UPDATE`;
      const seat = seats[0];

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
      if (seat.version !== expectedVersion) {
        return {
          success: false,
          code: 'VERSION_CONFLICT' as BookingErrorCode,
          message: `Version conflict: expected ${expectedVersion}, got ${seat.version}`,
          currentStatus: seat.status as SeatStatus,
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
          currentStatus: seat.status as SeatStatus,
          currentVersion: seat.version,
        };
      }

      if (seat.status === 'blocked') {
        return {
          success: false,
          code: 'SEAT_NOT_AVAILABLE' as BookingErrorCode,
          message: `Seat ${seat.display_label} is not available`,
          currentStatus: seat.status as SeatStatus,
          currentVersion: seat.version,
        };
      }

      if (seat.status === 'held') {
        if (seat.held_by !== userId) {
          return {
            success: false,
            code: 'SEAT_ALREADY_HELD' as BookingErrorCode,
            message: `Seat ${seat.display_label} is held by another user`,
            currentStatus: seat.status as SeatStatus,
            currentVersion: seat.version,
          };
        }

        if (seat.hold_expires_at && seat.hold_expires_at < now) {
          return {
            success: false,
            code: 'HOLD_EXPIRED' as BookingErrorCode,
            message: 'Your hold on this seat has expired',
            currentStatus: 'available',
            currentVersion: seat.version,
          };
        }
      }

      // ========================================================================
      // STEP 4: Verify event is open for booking
      // ========================================================================
      const event = await tx.event.findUnique({
        where: { id: eventId }
      });

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

      if (now < event.bookingOpens) {
        return {
          success: false,
          code: 'BOOKING_NOT_OPEN' as BookingErrorCode,
          message: `Booking opens at ${event.bookingOpens.toISOString()}`,
        };
      }

      if (now > event.bookingCloses) {
        return {
          success: false,
          code: 'BOOKING_CLOSED' as BookingErrorCode,
          message: 'Booking for this event has closed',
        };
      }

      // ========================================================================
      // STEP 5: Update seat status to 'booked'
      // ========================================================================
      const updatedSeat = await tx.seat.update({
        where: { id: seatId, version: expectedVersion },
        data: {
          status: 'booked',
          heldById: userId,
          holdExpiresAt: null,
          version: { increment: 1 }
        }
      });

      // ========================================================================
      // STEP 6: Create booking record
      // ========================================================================
      const priceCents = Math.round(event.basePriceCents * updatedSeat.priceMultiplier.toNumber());

      const booking = await tx.booking.create({
        data: {
          seatId,
          eventId,
          userId,
          priceCents,
          currency: event.currency,
          paymentStatus: 'completed',
          confirmationCode: generateConfirmationCode()
        }
      });

      // ========================================================================
      // STEP 7: Insert audit log entry
      // ========================================================================
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'seat',
          entityId: seatId,
          action: 'book',
          actorId: userId,
          oldValues: { status: seat.status, version: seat.version },
          newValues: {
            status: 'booked',
            version: updatedSeat.version,
            bookingId: booking.id,
          }
        }
      });

      // ========================================================================
      // STEP 8: Return success
      // ========================================================================
      return {
        success: true as const,
        booking: {
          id: booking.id,
          seatId: booking.seatId,
          eventId: booking.eventId,
          userId: booking.userId,
          confirmationCode: booking.confirmationCode,
          priceCents: booking.priceCents,
          currency: booking.currency,
          paymentIntentId: booking.paymentIntentId,
          paymentStatus: booking.paymentStatus as Booking['paymentStatus'],
          status: booking.status as Booking['status'],
          bookedAt: booking.bookedAt,
          cancelledAt: booking.cancelledAt,
          checkedInAt: booking.checkedInAt,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
          version: booking.version,
        },
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.eventId,
          section: updatedSeat.section,
          rowName: updatedSeat.rowName,
          seatNumber: updatedSeat.seatNumber,
          displayLabel: updatedSeat.displayLabel,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.priceMultiplier.toNumber(),
          status: updatedSeat.status as SeatStatus,
          heldBy: updatedSeat.heldById,
          holdExpiresAt: updatedSeat.holdExpiresAt,
          version: updatedSeat.version,
          createdAt: updatedSeat.createdAt,
          updatedAt: updatedSeat.updatedAt,
        },
      };
    });
  } catch (error: any) {
    if (error.code === 'P2025') { // Prisma Record Not Found (Update failed)
       return {
         success: false,
         code: 'VERSION_CONFLICT' as BookingErrorCode,
         message: 'Version conflict or seat disappeared',
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
    return await prisma.$transaction(async (tx: any) => {
      // Acquire row lock
      const seats = await tx.$queryRaw<any[]>`SELECT * FROM seats WHERE id = ${seatId}::uuid FOR UPDATE`;
      const seat = seats[0];

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
          currentStatus: seat.status as SeatStatus,
          currentVersion: seat.version,
        };
      }

      // Can only hold available seats
      if (seat.status !== 'available') {
        const errorMap: Record<string, { code: BookingErrorCode; message: string }> = {
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
        };

        const error = errorMap[seat.status] || { code: 'INTERNAL_ERROR' as BookingErrorCode, message: 'Unknown status' };

        return {
          success: false,
          code: error.code,
          message: error.message,
          currentStatus: seat.status as SeatStatus,
          currentVersion: seat.version,
        };
      }

      // Calculate hold expiration
      const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS);

      // Update seat
      const updatedSeat = await tx.seat.update({
        where: { id: seatId, version: expectedVersion },
        data: {
          status: 'held',
          heldById: userId,
          holdExpiresAt: holdExpiresAt,
          version: { increment: 1 }
        }
      });

      // Audit log
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'seat',
          entityId: seatId,
          action: 'hold',
          actorId: userId,
          oldValues: { status: seat.status, version: seat.version },
          newValues: {
            status: 'held',
            version: updatedSeat.version,
            holdExpiresAt: holdExpiresAt.toISOString(),
          }
        }
      });

      return {
        success: true as const,
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.eventId,
          section: updatedSeat.section,
          rowName: updatedSeat.rowName,
          seatNumber: updatedSeat.seatNumber,
          displayLabel: updatedSeat.displayLabel,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.priceMultiplier.toNumber(),
          status: updatedSeat.status as SeatStatus,
          heldBy: updatedSeat.heldById,
          holdExpiresAt: updatedSeat.holdExpiresAt,
          version: updatedSeat.version,
          createdAt: updatedSeat.createdAt,
          updatedAt: updatedSeat.updatedAt,
        },
        holdExpiresAt,
      };
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
       return {
         success: false,
         code: 'VERSION_CONFLICT' as BookingErrorCode,
         message: 'Version conflict or seat disappeared',
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
    return await prisma.$transaction(async (tx: any) => {
      const seats = await tx.$queryRaw<any[]>`SELECT * FROM seats WHERE id = ${seatId}::uuid FOR UPDATE`;
      const seat = seats[0];

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

      const updatedSeat = await tx.seat.update({
        where: { id: seatId },
        data: {
          status: 'available',
          heldById: null,
          holdExpiresAt: null,
          version: { increment: 1 }
        }
      });

      // If there was a booking, cancel it
      if (seat.status === 'booked') {
        await tx.booking.updateMany({
          where: { seatId, status: 'confirmed' },
          data: { status: 'cancelled', cancelledAt: new Date() }
        });
      }

      // Audit log
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'seat',
          entityId: seatId,
          action: 'release',
          actorId: userId,
          oldValues: { status: seat.status, version: seat.version },
          newValues: { status: 'available', version: updatedSeat.version }
        }
      });

      return {
        success: true as const,
        seat: {
          id: updatedSeat.id,
          eventId: updatedSeat.eventId,
          section: updatedSeat.section,
          rowName: updatedSeat.rowName,
          seatNumber: updatedSeat.seatNumber,
          displayLabel: updatedSeat.displayLabel,
          category: updatedSeat.category as Seat['category'],
          priceMultiplier: updatedSeat.priceMultiplier.toNumber(),
          status: updatedSeat.status as SeatStatus,
          heldBy: updatedSeat.heldById,
          holdExpiresAt: updatedSeat.holdExpiresAt,
          version: updatedSeat.version,
          createdAt: updatedSeat.createdAt,
          updatedAt: updatedSeat.updatedAt,
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
  return await prisma.$transaction(async (tx: any) => {
    // Acquire handles for seats that need expiration
    // We update them directly
    const now = new Date();
    
    // Find seats to expire
    const seatsToExpire = await tx.seat.findMany({
      where: {
        status: 'held',
        holdExpiresAt: { lt: now }
      },
      select: { id: true, displayLabel: true }
    });

    if (seatsToExpire.length === 0) {
      return { expiredCount: 0, expiredSeatIds: [] };
    }

    const ids = seatsToExpire.map((s: { id: string }) => s.id);

    // Perform bulk update
    await tx.seat.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'available',
        heldById: null,
        holdExpiresAt: null,
        version: { increment: 1 }
      }
    });

    // Log all expirations in audit log
    for (const seat of seatsToExpire) {
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'seat',
          entityId: seat.id,
          action: 'expire_hold',
          actorType: 'system',
          newValues: { status: 'available', reason: 'hold_expired' }
        }
      });
    }

    return {
      expiredCount: seatsToExpire.length,
      expiredSeatIds: ids,
    };
  });
}

/**
 * Refund a booking - THE REVERSE WRITE PATH
 * 
 * Atomically marks a booking as refunded and releases the seat.
 * Admin only (authorization checked in server action).
 */
export async function refundBooking(
  bookingId: UUID,
  adminId: UUID
): Promise<{ 
  success: true; 
  seatId: UUID; 
  eventId: UUID; 
  seat: { 
    section: string; 
    rowName: string; 
    seatNumber: string; 
    displayLabel: string; 
  } 
} | { success: false; message: string }> {
  try {
    return await prisma.$transaction(async (tx: any) => {
      // 1. Find the booking
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { seat: true }
      })

      if (!booking) {
        return { success: false, message: 'Booking not found' }
      }

      if (booking.status === 'cancelled' || booking.paymentStatus === 'refunded') {
        return { success: false, message: 'Booking has already been refunded or cancelled' }
      }

      // 2. Lock the seat
      await tx.$queryRaw`SELECT * FROM seats WHERE id = ${booking.seatId}::uuid FOR UPDATE`

      // 3. Update booking
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'cancelled',
          paymentStatus: 'refunded',
          cancelledAt: new Date()
        }
      })

      // 4. Update seat
      const updatedSeat = await tx.seat.update({
        where: { id: booking.seatId },
        data: {
          status: 'available',
          heldById: null,
          holdExpiresAt: null,
          version: { increment: 1 }
        }
      })

      // 5. Audit log
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'booking',
          entityId: bookingId,
          action: 'refund',
          actorId: adminId,
          oldValues: { status: booking.status, paymentStatus: booking.paymentStatus },
          newValues: { status: 'cancelled', paymentStatus: 'refunded', seatStatus: 'available' }
        }
      })

      return { 
        success: true, 
        seatId: booking.seatId,
        eventId: booking.eventId,
        seat: {
          section: updatedSeat.section,
          rowName: updatedSeat.rowName,
          seatNumber: updatedSeat.seatNumber,
          displayLabel: updatedSeat.displayLabel
        }
      }
    })
  } catch (error: any) {
    console.error('Error in refundBooking:', error)
    return { success: false, message: error.message || 'Failed to refund booking' }
  }
}

/**
 * Atomically cancels an event, refunds all its bookings, and releases all seats.
 */
export async function bulkRefundEventBookings(
  eventId: UUID,
  adminId: UUID
): Promise<{ 
  success: true; 
  releasedSeats: Array<{
    id: UUID;
    section: string;
    rowName: string;
    seatNumber: string;
    displayLabel: string;
  }>
} | { success: false; message: string }> {
  try {
    return await prisma.$transaction(async (tx: any) => {
      // 1. Verify event exists and is not already cancelled
      const event = await tx.event.findUnique({
        where: { id: eventId }
      })

      if (!event) {
        return { success: false, message: 'Event not found' }
      }

      if (event.status === 'cancelled') {
        return { success: false, message: 'Event is already cancelled' }
      }

      // 2. Load all confirmed bookings for this event
      const bookings = await tx.booking.findMany({
        where: { 
          eventId,
          status: 'confirmed'
        },
        include: { seat: true }
      })

      // 3. Mark event as cancelled
      await tx.event.update({
        where: { id: eventId },
        data: { 
          status: 'cancelled',
          version: { increment: 1 }
        }
      })

      // 4. Update all active bookings to cancelled/refunded
      if (bookings.length > 0) {
        await tx.booking.updateMany({
          where: { 
            eventId,
            status: 'confirmed'
          },
          data: {
            status: 'cancelled',
            paymentStatus: 'refunded',
            cancelledAt: new Date(),
            version: { increment: 1 }
          }
        })
      }

      // 5. Identify seats that need to be released
      const changedSeats = await tx.seat.findMany({
        where: {
          eventId,
          status: { in: ['booked', 'held'] }
        },
        select: {
          id: true,
          section: true,
          rowName: true,
          seatNumber: true,
          displayLabel: true
        }
      })

      // 6. Release those seats
      if (changedSeats.length > 0) {
        await tx.seat.updateMany({
          where: { 
            id: { in: changedSeats.map((s: any) => s.id) }
          },
          data: {
            status: 'available',
            heldById: null,
            holdExpiresAt: null,
            version: { increment: 1 }
          }
        })
      }

      // 7. Audit logs
      // Event cancellation log
      await tx.bookingAuditLog.create({
        data: {
          entityType: 'event',
          entityId: eventId,
          action: 'cancel_event',
          actorId: adminId,
          newValues: { status: 'cancelled', bookingsRefunded: bookings.length, seatsReleased: changedSeats.length }
        }
      })

      return { 
        success: true, 
        releasedSeats: changedSeats
      }
    }, {
      // Give the transaction more time for large events
      timeout: 30000 
    })
  } catch (error: any) {
    console.error('Error in bulkRefundEventBookings:', error)
    return { success: false, message: error.message || 'Failed to bulk refund bookings' }
  }
}

