# Race Condition Walkthrough

## Two Users Booking the Same Seat Simultaneously

This document walks through exactly what happens when two users (Alice and Bob) try to book the same seat at the exact same moment.

---

## Scenario Setup

```
Event: Summer Concert 2025
Seat: A-1-5 (Row 1, Seat 5, Section A)
Initial State:
  - status: 'available'
  - version: 1
  - held_by: NULL

Alice: User ID = alice-uuid
Bob: User ID = bob-uuid

Both users are viewing the seat map and see A-1-5 as available.
Both click "Book" within milliseconds of each other.
```

---

## Timeline: What Happens

```
Time    Alice's Browser              Server                    Bob's Browser
─────────────────────────────────────────────────────────────────────────────────────
T+0ms   [Click "Book A-1-5"]                                   [Click "Book A-1-5"]
        │                                                       │
        │ Optimistic Update:                                    │ Optimistic Update:
        │ A-1-5 → 'pending'                                     │ A-1-5 → 'pending'
        │                                                       │
T+5ms   └─── HTTP POST ───────────┐                             │
        bookSeatAction({          │                             │
          seatId: A-1-5,          │                             │
          expectedVersion: 1      │                             │
        })                        │                             │
                                  │                             │
T+8ms                             │         ┌─── HTTP POST ─────┘
                                  │         │  bookSeatAction({
                                  │         │    seatId: A-1-5,
                                  │         │    expectedVersion: 1
                                  │         │  })
                                  │         │
                                  ▼         ▼
T+10ms                     ┌─────────────────────┐
                           │  PostgreSQL Server  │
                           └─────────────────────┘
                                  │
                                  │ Both requests arrive
                                  │ concurrently
                                  ▼
```

---

## PostgreSQL Transaction Flow

### Alice's Transaction (starts first by ~2ms)

```sql
-- T+10ms: BEGIN TRANSACTION
BEGIN;

-- T+11ms: Acquire exclusive row lock
-- This is the CRITICAL step - first one here WINS
SELECT * FROM seats WHERE id = 'a1-5-uuid' FOR UPDATE;

-- Result: Row is locked. Alice's transaction now has exclusive access.
-- Any other transaction trying to SELECT FOR UPDATE will WAIT.

┌──────────────────────────────────────────────────────────────┐
│ ALICE HAS THE LOCK                                           │
│ status: 'available', version: 1, held_by: NULL               │
└──────────────────────────────────────────────────────────────┘

-- T+12ms: Validate (all checks pass)
-- - Seat is available ✓
-- - Version matches (1 = 1) ✓
-- - Event is published ✓
-- - Booking window is open ✓

-- T+13ms: UPDATE seat
UPDATE seats
SET status = 'booked',
    held_by = 'alice-uuid',
    version = version + 1,  -- version becomes 2
    updated_at = NOW()
WHERE id = 'a1-5-uuid' AND version = 1
RETURNING *;

-- Result: 1 row updated
-- New state: status='booked', version=2, held_by='alice-uuid'

-- T+14ms: INSERT booking
INSERT INTO bookings (seat_id, event_id, user_id, price_cents, ...)
VALUES ('a1-5-uuid', 'event-uuid', 'alice-uuid', 7500, ...);

-- T+15ms: COMMIT
COMMIT;

-- Alice's transaction completes successfully!
```

### Bob's Transaction (waiting for lock)

```sql
-- T+12ms: BEGIN TRANSACTION
BEGIN;

-- T+12ms: Try to acquire row lock
SELECT * FROM seats WHERE id = 'a1-5-uuid' FOR UPDATE;

-- ⏳ BLOCKED! Alice holds the lock.
-- Bob's transaction WAITS here until Alice commits or rolls back.

-- ... waiting ...
-- ... waiting ...
-- ... waiting ...

-- T+15ms: Alice commits, lock is released
-- Bob's SELECT FOR UPDATE finally completes

┌──────────────────────────────────────────────────────────────┐
│ BOB GETS THE LOCK (but sees Alice's committed changes!)      │
│ status: 'booked', version: 2, held_by: 'alice-uuid'          │
└──────────────────────────────────────────────────────────────┘

-- T+16ms: Validate
-- Bob's code checks: seat.status === 'available'?
-- Result: NO! status is 'booked'

-- The validation fails BEFORE we even try the UPDATE

-- T+17ms: ROLLBACK (no changes made)
ROLLBACK;

-- Bob's transaction fails with: SEAT_ALREADY_BOOKED
```

---

## API Responses

### Alice's Response (Success)

```json
{
  "success": true,
  "booking": {
    "id": "booking-uuid-alice",
    "seatId": "a1-5-uuid",
    "eventId": "event-uuid",
    "userId": "alice-uuid",
    "confirmationCode": "TKT-A1B2C3",
    "priceCents": 7500,
    "currency": "USD",
    "status": "confirmed",
    "bookedAt": "2025-01-15T10:30:00.123Z"
  },
  "seat": {
    "id": "a1-5-uuid",
    "displayLabel": "A-1-5",
    "status": "booked",
    "isOwnedByCurrentUser": true
  }
}
```

### Bob's Response (Failure)

```json
{
  "success": false,
  "error": {
    "code": "SEAT_ALREADY_BOOKED",
    "message": "Seat A-1-5 is already booked"
  }
}
```

---

## Client-Side Handling

### Alice's Browser

```
T+0ms:   User clicks "Book"
T+0ms:   Optimistic update: A-1-5 shows as "Booking..."
T+5ms:   HTTP request sent
T+20ms:  Response received: SUCCESS!
T+20ms:  UI update: A-1-5 shows as "Your Seat ✓"
T+20ms:  Show toast: "Booking confirmed! TKT-A1B2C3"
```

### Bob's Browser

```
T+0ms:   User clicks "Book"
T+0ms:   Optimistic update: A-1-5 shows as "Booking..."
T+8ms:   HTTP request sent
T+25ms:  Response received: FAILURE
T+25ms:  ROLLBACK: A-1-5 reverts to previous visual state
T+25ms:  Show toast: "Sorry, this seat was just booked by someone else"

T+30ms:  SSE Event arrives: seat.booked for A-1-5
T+30ms:  UI update: A-1-5 shows as "Sold" (red/unavailable)
```

---

## Why This Works: The Guarantees

### 1. SELECT FOR UPDATE Serializes Access

```
┌─────────────────────────────────────────────────────────────────┐
│                    ROW LOCK BEHAVIOR                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Transaction A                    Transaction B                 │
│  ─────────────                    ─────────────                 │
│       │                                │                        │
│       ▼                                │                        │
│  SELECT FOR UPDATE ◄─── Acquires ───┐  │                        │
│       │                  lock       │  │                        │
│       │                             │  ▼                        │
│       │                             │  SELECT FOR UPDATE        │
│       │                             │       │                   │
│       │                             │       ▼                   │
│       │                             │  ⏳ BLOCKED               │
│       │                             │       │                   │
│  UPDATE                             │       │                   │
│       │                             │       │                   │
│  COMMIT ────────────────────────────┼───────┤                   │
│       │             Lock released ──┘       │                   │
│       ▼                                     ▼                   │
│  ✓ Success                          Gets stale data?            │
│                                     NO! Sees committed state    │
│                                            │                    │
│                                            ▼                    │
│                                     Validation fails            │
│                                            │                    │
│                                            ▼                    │
│                                     ✗ SEAT_ALREADY_BOOKED       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Optimistic Locking Catches Stale Reads

Even if somehow both transactions got past the status check, the version mismatch would catch it:

```sql
-- Alice updates with version=1 → version=2
UPDATE seats SET status='booked', version=version+1 WHERE id=$1 AND version=1;
-- Returns: 1 row affected ✓

-- Bob tries with version=1, but it's now 2
UPDATE seats SET status='booked', version=version+1 WHERE id=$1 AND version=1;
-- Returns: 0 rows affected ✗
-- Throws: OptimisticLockError
```

### 3. UNIQUE Constraint (Belt AND Suspenders)

Even if the code had bugs, the database constraint prevents double booking:

```sql
-- The bookings table has:
CONSTRAINT bookings_unique_active_seat UNIQUE (seat_id)

-- Second INSERT would fail with:
-- ERROR: duplicate key value violates unique constraint "bookings_unique_active_seat"
```

---

## Race Condition Variants Handled

### Variant 1: Same User, Two Tabs

```
Tab A clicks "Book"     Tab B clicks "Book"
       │                       │
       ▼                       ▼
   First wins              Gets error:
   (confirmed)             "SEAT_ALREADY_BOOKED"
                           (same user, doesn't matter)
```

### Variant 2: Hold Expiration Race

```
Alice holds seat        Bob waits for expiration
       │                       │
       ▼                       │
  hold_expires_at = T+10min    │
       │                       │
       │                At T+9:59:59
       │                Bob clicks "Book"
       │                       │
       ▼                       ▼
  Alice: HOLD_EXPIRED    Bob: Gets the seat
  (her hold expired)     (fair - she was too slow)
```

### Variant 3: Network Partition

```
Alice's request         Bob's request
sent at T+0             sent at T+0
       │                       │
       │  [Network delay]      ▼
       │       ...        Processed at T+100ms
       │       ...        Bob wins!
       ▼                       │
  Processed at T+200ms         │
  Alice loses                  │
  (fair - network is reality)  │
```

---

## What About "Last Write Wins"?

Some systems use Last Write Wins (LWW) for simplicity. Why don't we?

**LWW Example (BAD for ticketing):**

```
T+0:  Alice books seat → SUCCESS
T+1:  Bob books seat → SUCCESS (overwrites Alice!)
T+2:  Alice gets confirmation email
T+3:  Bob gets confirmation email
T+4:  Two people show up for same seat 😱
```

**Our Approach (First Write Wins with validation):**

```
T+0:  Alice books seat → SUCCESS
T+1:  Bob books seat → REJECTED (seat already booked)
T+2:  Only Alice gets confirmation
T+3:  One person shows up ✓
```

---

## Summary: Why Correctness is Guaranteed

| Protection Layer | What It Does | When It Kicks In |
|-----------------|--------------|------------------|
| SELECT FOR UPDATE | Serializes concurrent access | Two transactions touch same row |
| Status Check | Validates seat is bookable | After acquiring lock |
| Version Check | Prevents lost updates | Client has stale data |
| UNIQUE Constraint | Database-level double-book prevention | Code bugs slip through |
| Transaction Rollback | Automatic cleanup on any error | Exception thrown anywhere |

**The math:**
- P(double booking) = P(bypass lock) × P(bypass status) × P(bypass version) × P(bypass constraint)
- P(double booking) = 0 × 0 × 0 × 0 = **0**

---

## Appendix: Full SQL Transaction Log

```sql
-- ============================================================
-- ALICE'S WINNING TRANSACTION
-- ============================================================

-- Connection 1 (Alice)
BEGIN;

SELECT id, event_id, status, held_by, version
FROM seats
WHERE id = 'a1-5-uuid'
FOR UPDATE;

-- Returns: id=a1-5-uuid, status=available, held_by=NULL, version=1
-- Row is now LOCKED

-- Validation passes...

UPDATE seats
SET status = 'booked',
    held_by = 'alice-uuid',
    hold_expires_at = NULL,
    version = version + 1,
    updated_at = NOW()
WHERE id = 'a1-5-uuid' AND version = 1
RETURNING *;

-- Returns: 1 row, version now = 2

INSERT INTO bookings (seat_id, event_id, user_id, price_cents, currency, payment_status)
VALUES ('a1-5-uuid', 'event-uuid', 'alice-uuid', 7500, 'USD', 'completed')
RETURNING *;

-- Returns: new booking with confirmation_code

INSERT INTO booking_audit_log (entity_type, entity_id, action, actor_id, actor_type, old_values, new_values)
VALUES ('seat', 'a1-5-uuid', 'book', 'alice-uuid', 'user',
        '{"status":"available","version":1}',
        '{"status":"booked","version":2,"bookingId":"booking-uuid"}');

COMMIT;  -- Success! Lock released.

-- ============================================================
-- BOB'S FAILING TRANSACTION
-- ============================================================

-- Connection 2 (Bob)
BEGIN;

SELECT id, event_id, status, held_by, version
FROM seats
WHERE id = 'a1-5-uuid'
FOR UPDATE;

-- BLOCKED until Alice commits...
-- ...
-- Now returns: id=a1-5-uuid, status=booked, held_by=alice-uuid, version=2

-- Validation FAILS:
-- if (seat.status === 'booked') return { success: false, code: 'SEAT_ALREADY_BOOKED' }

ROLLBACK;  -- No changes made, clean exit
```
