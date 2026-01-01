// ============================================================================
// CORE DOMAIN TYPES
// ============================================================================

export type UUID = string;

// ----------------------------------------------------------------------------
// User Types
// ----------------------------------------------------------------------------
export interface User {
  id: UUID;
  email: string;
  fullName: string;
  phone: string | null;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ----------------------------------------------------------------------------
// Event Types
// ----------------------------------------------------------------------------
export interface Event {
  id: UUID;
  name: string;
  description: string | null;
  venueName: string;
  venueAddress: string | null;
  eventDate: Date;
  doorsOpen: Date | null;
  bookingOpens: Date;
  bookingCloses: Date;
  totalSeats: number;
  basePriceCents: number;
  currency: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  createdBy: UUID;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ----------------------------------------------------------------------------
// Seat Types
// ----------------------------------------------------------------------------
export type SeatStatus = 'available' | 'held' | 'booked' | 'blocked';
export type SeatCategory = 'standard' | 'premium' | 'vip' | 'accessible' | 'restricted';

export interface Seat {
  id: UUID;
  eventId: UUID;
  section: string;
  rowName: string;
  seatNumber: string;
  displayLabel: string;
  category: SeatCategory;
  priceMultiplier: number;
  status: SeatStatus;
  heldBy: UUID | null;
  holdExpiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Client-optimized seat for rendering seat maps
export interface SeatMapItem {
  id: UUID;
  displayLabel: string;
  section: string;
  rowName: string;
  seatNumber: string;
  category: SeatCategory;
  status: SeatStatus;
  priceCents: number;
  // Only included if the current user holds/owns this seat
  isOwnedByCurrentUser: boolean;
}

// ----------------------------------------------------------------------------
// Booking Types
// ----------------------------------------------------------------------------
export type PaymentStatus = 'pending' | 'completed' | 'refunded' | 'failed';
export type BookingStatus = 'confirmed' | 'cancelled' | 'checked_in' | 'no_show';

export interface Booking {
  id: UUID;
  seatId: UUID;
  eventId: UUID;
  userId: UUID;
  confirmationCode: string;
  priceCents: number;
  currency: string;
  paymentIntentId: string | null;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  bookedAt: Date;
  cancelledAt: Date | null;
  checkedInAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ----------------------------------------------------------------------------
// API Response Types
// ----------------------------------------------------------------------------
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Specific error codes for booking operations
export type BookingErrorCode =
  | 'SEAT_NOT_FOUND'
  | 'SEAT_NOT_AVAILABLE'
  | 'SEAT_ALREADY_HELD'
  | 'SEAT_ALREADY_BOOKED'
  | 'VERSION_CONFLICT'           // Optimistic lock failed
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_PUBLISHED'
  | 'BOOKING_NOT_OPEN'
  | 'BOOKING_CLOSED'
  | 'HOLD_EXPIRED'
  | 'USER_NOT_AUTHENTICATED'
  | 'PAYMENT_FAILED'
  | 'INTERNAL_ERROR';

// ----------------------------------------------------------------------------
// Server Action Types
// ----------------------------------------------------------------------------
export interface BookSeatRequest {
  eventId: UUID;
  seatId: UUID;
  optimisticId: string;          // Client-generated ID for optimistic updates
  expectedVersion: number;        // For optimistic locking
}

export interface BookSeatResponse {
  success: boolean;
  booking?: Booking;
  seat?: SeatMapItem;
  error?: {
    code: BookingErrorCode;
    message: string;
  };
}

export interface HoldSeatRequest {
  eventId: UUID;
  seatId: UUID;
  expectedVersion: number;
}

export interface HoldSeatResponse {
  success: boolean;
  seat?: SeatMapItem;
  holdExpiresAt?: Date;
  error?: {
    code: BookingErrorCode;
    message: string;
  };
}

export interface ReleaseSeatRequest {
  eventId: UUID;
  seatId: UUID;
}

export interface ReleaseSeatResponse {
  success: boolean;
  seat?: SeatMapItem;
  error?: {
    code: BookingErrorCode;
    message: string;
  };
}

export interface CreateEventRequest {
  name: string;
  description?: string;
  venueName: string;
  venueAddress?: string;
  eventDate: string; // ISO string from form
  doorsOpen?: string; // ISO string from form
  bookingOpens: string; // ISO string from form
  bookingCloses: string; // ISO string from form
  totalSeats: number;
  basePriceCents: number;
  currency?: string;
}

export interface CreateEventResponse {
  success: boolean;
  event?: Event;
  error?: {
    code: string;
    message: string;
  };
}

// ----------------------------------------------------------------------------
// Real-time Event Types (SSE/WebSocket)
// ----------------------------------------------------------------------------
export type RealtimeEventType =
  | 'seat.held'
  | 'seat.released'
  | 'seat.booked'
  | 'seat.expired'
  | 'seats.bulk_update';

export interface RealtimeEvent<T = unknown> {
  type: RealtimeEventType;
  eventId: UUID;                  // The event (concert) this relates to
  timestamp: string;              // ISO timestamp
  payload: T;
}

export interface SeatStatusChangePayload {
  seatId: UUID;
  previousStatus: SeatStatus;
  newStatus: SeatStatus;
  displayLabel: string;
  // Excluded: userId (privacy) - only included if it's the current user's action
  isCurrentUser?: boolean;
}

export interface BulkSeatUpdatePayload {
  seats: Array<{
    seatId: UUID;
    status: SeatStatus;
    displayLabel: string;
  }>;
}

// ----------------------------------------------------------------------------
// Kafka Event Types
// ----------------------------------------------------------------------------
export interface KafkaBookingEvent {
  type: 'seat.booked' | 'seat.released' | 'seat.held' | 'seat.expired';
  version: '1.0';
  timestamp: string;
  traceId: UUID;
  payload: {
    eventId: UUID;
    seatId: UUID;
    userId: UUID;
    previousStatus: SeatStatus;
    newStatus: SeatStatus;
    bookingId?: UUID;
    metadata: {
      section: string;
      rowName: string;
      seatNumber: string;
      displayLabel: string;
      priceCents?: number;
    };
  };
}

// ----------------------------------------------------------------------------
// Client State Types
// ----------------------------------------------------------------------------
export interface OptimisticUpdate {
  id: string;                     // optimisticId from request
  seatId: UUID;
  previousStatus: SeatStatus;
  pendingStatus: SeatStatus;
  timestamp: number;
  rollback: () => void;
}

export interface SeatMapState {
  seats: Map<UUID, SeatMapItem>;
  optimisticUpdates: Map<string, OptimisticUpdate>;
  isConnected: boolean;
  lastSyncTimestamp: number;
}
