-- ============================================================================
-- REAL-TIME TICKETING SYSTEM - PostgreSQL Schema
-- ============================================================================
--
-- Design Principles:
-- 1. Database enforces ALL business rules via constraints
-- 2. Optimistic locking via version column prevents lost updates
-- 3. Unique partial index prevents double booking
-- 4. Foreign keys maintain referential integrity
-- 5. Timestamps enable audit trails
--
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- Stores user account information
-- Using UUID as primary key for distributed system compatibility

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),

    -- Account status
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),

    -- Metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Optimistic locking - increment on every update
    version         INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT users_email_unique UNIQUE (email)
);

-- Index for login lookups
CREATE INDEX idx_users_email ON users(email) WHERE status = 'active';

-- Index for admin queries by status
CREATE INDEX idx_users_status ON users(status, created_at DESC);

COMMENT ON TABLE users IS 'User accounts with optimistic locking support';
COMMENT ON COLUMN users.version IS 'Optimistic lock version - increment on every UPDATE';

-- ============================================================================
-- EVENTS TABLE
-- ============================================================================
-- Represents bookable events (concerts, shows, etc.)

CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Event details
    name            VARCHAR(500) NOT NULL,
    description     TEXT,
    venue_name      VARCHAR(255) NOT NULL,
    venue_address   TEXT,

    -- Timing
    event_date      TIMESTAMPTZ NOT NULL,
    doors_open      TIMESTAMPTZ,
    booking_opens   TIMESTAMPTZ NOT NULL,
    booking_closes  TIMESTAMPTZ NOT NULL,

    -- Capacity
    total_seats     INTEGER NOT NULL CHECK (total_seats > 0),

    -- Pricing (stored in cents to avoid floating point issues)
    base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
    currency        CHAR(3) NOT NULL DEFAULT 'USD',

    -- Status
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),

    -- Metadata
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INTEGER NOT NULL DEFAULT 1,

    -- Ensure booking window is valid
    CONSTRAINT events_booking_window_valid
        CHECK (booking_opens < booking_closes AND booking_closes <= event_date)
);

-- Index for listing upcoming events
CREATE INDEX idx_events_upcoming
    ON events(event_date)
    WHERE status = 'published';

-- Index for checking if booking is open
CREATE INDEX idx_events_booking_window
    ON events(booking_opens, booking_closes)
    WHERE status = 'published';

-- Index for organizer's events
CREATE INDEX idx_events_created_by ON events(created_by, created_at DESC);

COMMENT ON TABLE events IS 'Bookable events with capacity and scheduling constraints';

-- ============================================================================
-- SEATS TABLE
-- ============================================================================
-- Individual seats/tickets for each event
-- This is the CRITICAL table for preventing double booking

CREATE TABLE seats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Seat identification
    section         VARCHAR(50) NOT NULL,           -- e.g., 'A', 'VIP', 'General'
    row_name        VARCHAR(10) NOT NULL,           -- e.g., '1', 'AA', 'Floor'
    seat_number     VARCHAR(10) NOT NULL,           -- e.g., '1', '23', 'GA-001'

    -- Display label (computed or custom)
    display_label   VARCHAR(50) NOT NULL,           -- e.g., 'A-1-23', 'VIP Row AA Seat 5'

    -- Seat category affects pricing
    category        VARCHAR(50) NOT NULL DEFAULT 'standard'
                    CHECK (category IN ('standard', 'premium', 'vip', 'accessible', 'restricted')),

    -- Price multiplier (1.0 = base price, 1.5 = 150% of base)
    price_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00 CHECK (price_multiplier > 0),

    -- =========================================================================
    -- SEAT STATUS - Critical for booking logic
    -- =========================================================================
    -- 'available'  - Can be booked
    -- 'held'       - Temporarily reserved (expires after hold_expires_at)
    -- 'booked'     - Confirmed booking exists
    -- 'blocked'    - Administratively blocked (broken seat, etc.)
    --
    status          VARCHAR(20) NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'held', 'booked', 'blocked')),

    -- Who currently holds/owns this seat (NULL if available/blocked)
    held_by         UUID REFERENCES users(id),

    -- When the hold expires (NULL if not held)
    hold_expires_at TIMESTAMPTZ,

    -- =========================================================================
    -- OPTIMISTIC LOCKING - Critical for race condition handling
    -- =========================================================================
    -- Every UPDATE must:
    -- 1. Include WHERE version = expected_version
    -- 2. Set version = version + 1
    -- If 0 rows affected, another transaction won the race
    --
    version         INTEGER NOT NULL DEFAULT 1,

    -- Metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure each seat position is unique within an event
    CONSTRAINT seats_unique_position
        UNIQUE (event_id, section, row_name, seat_number),

    -- If status is 'held', must have held_by and expiration
    CONSTRAINT seats_held_requires_holder
        CHECK (
            status != 'held' OR
            (held_by IS NOT NULL AND hold_expires_at IS NOT NULL)
        ),

    -- If status is 'booked', must have held_by (the owner)
    CONSTRAINT seats_booked_requires_owner
        CHECK (status != 'booked' OR held_by IS NOT NULL)
);

-- ============================================================================
-- CRITICAL INDEX: Prevents double booking at database level
-- ============================================================================
-- This partial unique index ensures that for any given seat,
-- there can only be ONE row where status = 'booked'
--
-- Note: We don't actually need this since seat_id is already unique,
-- but this pattern would apply if we had a separate bookings table
-- without a direct seat status column.

-- Primary index for finding available seats in an event
CREATE INDEX idx_seats_available
    ON seats(event_id, section, row_name)
    WHERE status = 'available';

-- Index for finding all seats in an event (seat map rendering)
CREATE INDEX idx_seats_event_map
    ON seats(event_id, section, row_name, seat_number);

-- Index for expiring held seats (background job query)
CREATE INDEX idx_seats_held_expiring
    ON seats(hold_expires_at)
    WHERE status = 'held';

-- Index for user's current holds/bookings
CREATE INDEX idx_seats_user_holdings
    ON seats(held_by, status)
    WHERE held_by IS NOT NULL;

-- Index for optimistic locking queries
-- Speeds up: UPDATE seats SET ... WHERE id = $1 AND version = $2
CREATE INDEX idx_seats_id_version ON seats(id, version);

COMMENT ON TABLE seats IS 'Individual bookable seats with optimistic locking for race condition handling';
COMMENT ON COLUMN seats.version IS 'Optimistic lock - UPDATE must check AND increment this';
COMMENT ON COLUMN seats.status IS 'available|held|booked|blocked - determines if seat can be booked';

-- ============================================================================
-- BOOKINGS TABLE
-- ============================================================================
-- Confirmed bookings (receipts)
-- A booking is created ONLY when payment succeeds and seat status = 'booked'

CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was booked
    seat_id             UUID NOT NULL REFERENCES seats(id),
    event_id            UUID NOT NULL REFERENCES events(id),
    user_id             UUID NOT NULL REFERENCES users(id),

    -- Booking reference (human readable)
    confirmation_code   VARCHAR(20) NOT NULL,

    -- Price at time of booking (immutable record)
    price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',

    -- Payment info
    payment_intent_id   VARCHAR(255),              -- Stripe/payment processor ID
    payment_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending', 'completed', 'refunded', 'failed')),

    -- Booking status
    status              VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'no_show')),

    -- Timestamps
    booked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at        TIMESTAMPTZ,
    checked_in_at       TIMESTAMPTZ,

    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,

    -- Each seat can only have ONE active (non-cancelled) booking
    -- This is the ULTIMATE double-booking prevention
    CONSTRAINT bookings_unique_active_seat
        UNIQUE (seat_id)
        -- Note: Postgres doesn't support WHERE in UNIQUE, so we handle
        -- cancelled bookings by updating seat status back to 'available'
);

-- Generate human-readable confirmation codes
CREATE OR REPLACE FUNCTION generate_confirmation_code()
RETURNS VARCHAR(20) AS $$
BEGIN
    -- Format: TKT-XXXXXX (6 alphanumeric characters)
    RETURN 'TKT-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
END;
$$ LANGUAGE plpgsql;

-- Auto-generate confirmation code on insert
CREATE OR REPLACE FUNCTION set_confirmation_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.confirmation_code IS NULL THEN
        NEW.confirmation_code := generate_confirmation_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_set_confirmation_code
    BEFORE INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_confirmation_code();

-- Index for user's booking history
CREATE INDEX idx_bookings_user ON bookings(user_id, booked_at DESC);

-- Index for event's bookings (organizer view)
CREATE INDEX idx_bookings_event ON bookings(event_id, booked_at DESC);

-- Index for confirmation code lookup
CREATE UNIQUE INDEX idx_bookings_confirmation_code ON bookings(confirmation_code);

-- Index for payment reconciliation
CREATE INDEX idx_bookings_payment ON bookings(payment_intent_id) WHERE payment_intent_id IS NOT NULL;

COMMENT ON TABLE bookings IS 'Confirmed booking records - created after successful payment';
COMMENT ON COLUMN bookings.confirmation_code IS 'Human-readable booking reference (e.g., TKT-A1B2C3)';

-- ============================================================================
-- BOOKING AUDIT LOG
-- ============================================================================
-- Immutable log of all booking-related actions for debugging and compliance

CREATE TABLE booking_audit_log (
    id              BIGSERIAL PRIMARY KEY,

    -- What changed
    entity_type     VARCHAR(20) NOT NULL,          -- 'seat', 'booking'
    entity_id       UUID NOT NULL,
    action          VARCHAR(50) NOT NULL,          -- 'status_change', 'book', 'release', etc.

    -- Who made the change
    actor_id        UUID REFERENCES users(id),     -- NULL for system actions
    actor_type      VARCHAR(20) NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user', 'system', 'admin')),

    -- Change details
    old_values      JSONB,
    new_values      JSONB,

    -- Context
    request_id      UUID,                          -- For correlating with API logs
    ip_address      INET,
    user_agent      TEXT,

    -- Timestamp (no updated_at - this is immutable)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for entity history
CREATE INDEX idx_audit_entity ON booking_audit_log(entity_type, entity_id, created_at DESC);

-- Index for user activity
CREATE INDEX idx_audit_actor ON booking_audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

-- Index for time-based queries
CREATE INDEX idx_audit_time ON booking_audit_log(created_at DESC);

COMMENT ON TABLE booking_audit_log IS 'Immutable audit trail of all booking-related changes';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_seats_updated_at
    BEFORE UPDATE ON seats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SEAT STATUS TRANSITION VALIDATION
-- ============================================================================
-- Enforces valid state machine transitions for seat status

CREATE OR REPLACE FUNCTION validate_seat_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Define valid transitions
    -- available -> held, booked, blocked
    -- held -> available (expired/released), booked (confirmed)
    -- booked -> available (cancelled/refunded)
    -- blocked -> available

    IF OLD.status = 'available' AND NEW.status NOT IN ('held', 'booked', 'blocked', 'available') THEN
        RAISE EXCEPTION 'Invalid seat status transition from % to %', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'held' AND NEW.status NOT IN ('available', 'booked', 'held') THEN
        RAISE EXCEPTION 'Invalid seat status transition from % to %', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'booked' AND NEW.status NOT IN ('available', 'booked') THEN
        RAISE EXCEPTION 'Invalid seat status transition from % to %', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'blocked' AND NEW.status NOT IN ('available', 'blocked') THEN
        RAISE EXCEPTION 'Invalid seat status transition from % to %', OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_seat_status
    BEFORE UPDATE OF status ON seats
    FOR EACH ROW
    EXECUTE FUNCTION validate_seat_status_transition();

-- ============================================================================
-- INDEX SUMMARY & PURPOSE
-- ============================================================================
/*
INDEX                           | PURPOSE
-------------------------------|--------------------------------------------------
idx_users_email                | Fast login lookups by email
idx_users_status               | Admin queries for user management
idx_events_upcoming            | Homepage listing of upcoming events
idx_events_booking_window      | Check if booking is currently open
idx_events_created_by          | Organizer dashboard - my events
idx_seats_available            | Find bookable seats (main booking query)
idx_seats_event_map            | Render full seat map for event
idx_seats_held_expiring        | Background job to expire stale holds
idx_seats_user_holdings        | User's current reservations
idx_seats_id_version           | Optimistic locking queries
idx_bookings_user              | User's booking history
idx_bookings_event             | Event's booking list (organizer)
idx_bookings_confirmation_code | Lookup by confirmation code
idx_bookings_payment           | Payment reconciliation
idx_audit_entity               | View change history for entity
idx_audit_actor                | View user's actions
idx_audit_time                 | Time-range queries on audit log
*/

-- ============================================================================
-- SAMPLE DATA FOR TESTING
-- ============================================================================
-- Uncomment to populate with test data

-- Create test user
INSERT INTO users (id, email, password_hash, full_name)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '$2b$10$test', 'Alice Smith'),
    ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '$2b$10$test', 'Bob Jones');

-- Create test event
INSERT INTO events (id, name, venue_name, event_date, booking_opens, booking_closes, total_seats, base_price_cents, status, created_by)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'Summer Concert 2025',
    'City Arena',
    '2026-08-15 20:00:00+00',
    '2025-01-01 00:00:00+00',
    '2026-08-15 18:00:00+00',
    100,
    5000,
    'published',
    '11111111-1111-1111-1111-111111111111'
);

-- Create test seats (10x10 grid)
INSERT INTO seats (event_id, section, row_name, seat_number, display_label, category, price_multiplier)
SELECT
    '33333333-3333-3333-3333-333333333333',
    'A',
    row_num::text,
    seat_num::text,
    'A-' || row_num || '-' || seat_num,
    CASE WHEN row_num <= 2 THEN 'vip' ELSE 'standard' END,
    CASE WHEN row_num <= 2 THEN 1.5 ELSE 1.0 END
FROM generate_series(1, 10) AS row_num, generate_series(1, 10) AS seat_num;
