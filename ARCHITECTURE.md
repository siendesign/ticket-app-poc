# Real-Time Ticketing System Architecture

## Production-Ready Seat Booking with Guaranteed Consistency

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER (Browser)                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │  Next.js Client Components                                                    │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────────┐ │    │
│  │  │ SeatMap UI   │  │ Booking Form │  │ Real-time State (Zustand/React Q) │ │    │
│  │  │ (Optimistic) │  │              │  │ - Server state cache               │ │    │
│  │  └──────┬───────┘  └──────┬───────┘  │ - Optimistic updates queue         │ │    │
│  │         │                 │          │ - Rollback handlers                 │ │    │
│  │         │                 │          └────────────────────────────────────┘ │    │
│  │         ▼                 ▼                              ▲                   │    │
│  │  ┌──────────────────────────────────┐                    │                   │    │
│  │  │     Server Actions / API Calls    │◄───────────────────┘                   │    │
│  │  └──────────────────────────────────┘                                        │    │
│  └───────────────────────────┬─────────────────────────────────────────────────┘    │
│                              │                              ▲                        │
│                              │ HTTP POST                    │ SSE/WebSocket          │
│                              ▼                              │                        │
└──────────────────────────────┼──────────────────────────────┼────────────────────────┘
                               │                              │
┌──────────────────────────────┼──────────────────────────────┼────────────────────────┐
│                              │    NEXT.JS SERVER            │                        │
│  ┌───────────────────────────▼────────────────────────────┐ │                        │
│  │              Server Actions / Route Handlers            │ │                        │
│  │  ┌─────────────────────────────────────────────────────┴─┴──────────────────┐    │
│  │  │  bookSeat()  │  releaseSeat()  │  getEventSeats()  │  SSE Publisher    │    │
│  │  └──────────────┴─────────────────┴───────────────────┴────────────────────┘    │
│  │                                │                              ▲                   │
│  │                                │                              │                   │
│  │                                ▼                              │                   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  │                    SINGLE WRITE PATH                                     │    │
│  │  │  ┌────────────────────────────────────────────────────────────────────┐ │    │
│  │  │  │  1. Validate request                                                │ │    │
│  │  │  │  2. BEGIN TRANSACTION                                               │ │    │
│  │  │  │  3. SELECT ... FOR UPDATE (acquire row lock)                        │ │    │
│  │  │  │  4. Check seat availability + version                               │ │    │
│  │  │  │  5. UPDATE seat (version++) OR ROLLBACK                             │ │    │
│  │  │  │  6. INSERT booking record                                           │ │    │
│  │  │  │  7. COMMIT                                                          │ │    │
│  │  │  │  8. Publish to Kafka (async, after commit)                          │ │    │
│  │  │  └────────────────────────────────────────────────────────────────────┘ │    │
│  │  └─────────────────────────────────────────────────────────────────────────┘    │
│  └──────────────────────────────┬────────────────────────────────────────────────┘  │
│                                 │                                                    │
└─────────────────────────────────┼────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────────┐
│   PostgreSQL     │    │      Kafka       │    │   Redis (Optional)       │
│   ════════════   │    │   ════════════   │    │   ════════════════       │
│                  │    │                  │    │                          │
│  Source of Truth │    │ Event Bus Only   │    │  Session Store           │
│  - Users         │    │ - seat.booked    │    │  Rate Limiting           │
│  - Events        │    │ - seat.released  │    │  SSE Connection Registry │
│  - Seats         │    │ - seat.expired   │    │                          │
│  - Bookings      │    │                  │    │                          │
│                  │    │  NO VALIDATION   │    │                          │
│  ACID Txns       │    │  PROPAGATION     │    │                          │
│  Row Locking     │    │  ONLY            │    │                          │
│  Constraints     │    │                  │    │                          │
└────────┬─────────┘    └────────┬─────────┘    └──────────────────────────┘
         │                       │
         │                       │
         │                       ▼
         │              ┌──────────────────────────────────────────────┐
         │              │           KAFKA CONSUMERS                     │
         │              │  ┌────────────────────────────────────────┐  │
         │              │  │  Broadcast Service                      │  │
         │              │  │  - Reads committed events               │  │
         │              │  │  - Pushes to all connected SSE clients  │  │
         │              │  │  - Partitioned by event_id              │  │
         │              │  └────────────────────────────────────────┘  │
         │              │  ┌────────────────────────────────────────┐  │
         │              │  │  Analytics Service                      │  │
         │              │  │  - Aggregates booking metrics           │  │
         │              │  └────────────────────────────────────────┘  │
         │              │  ┌────────────────────────────────────────┐  │
         │              │  │  Notification Service                   │  │
         │              │  │  - Sends confirmation emails            │  │
         │              │  └────────────────────────────────────────┘  │
         │              └──────────────────────────────────────────────┘
         │
         └──────────────────────────────────────────────────────────────┘
                        Consumers may read from DB for enrichment
```

---

## 2. Core Design Principles

### 2.1 Single Write Path
Every mutation flows through exactly one code path:
```
Client Request → Server Action → DB Transaction → Kafka Event → Broadcast
```

**Why?**
- Eliminates distributed consensus problems
- Makes reasoning about correctness trivial
- All validation happens in one place

### 2.2 Database as Single Source of Truth
- PostgreSQL enforces ALL business rules via constraints
- No in-memory validation that can drift from DB state
- Kafka events are derived FROM committed DB state, never the reverse

### 2.3 Real-time is Propagation Only
- WebSocket/SSE channels NEVER participate in write operations
- They receive events AFTER the database has committed
- Clients CANNOT trust real-time updates as authoritative until confirmed

### 2.4 Client is Never Source of Truth
- Optimistic UI is a UX convenience, not a data store
- Every optimistic update has a pending confirmation and rollback handler
- Server response always wins

---

## 3. Data Flow Sequence

```
┌─────────┐          ┌─────────┐          ┌──────────┐          ┌───────┐          ┌─────────┐
│ Client  │          │ Next.js │          │PostgreSQL│          │ Kafka │          │Broadcast│
│   A     │          │ Server  │          │          │          │       │          │ Service │
└────┬────┘          └────┬────┘          └────┬─────┘          └───┬───┘          └────┬────┘
     │                    │                    │                    │                   │
     │  1. bookSeat()     │                    │                    │                   │
     │ ──────────────────>│                    │                    │                   │
     │                    │                    │                    │                   │
     │                    │  2. BEGIN; SELECT  │                    │                   │
     │                    │     FOR UPDATE     │                    │                   │
     │                    │ ──────────────────>│                    │                   │
     │                    │                    │                    │                   │
     │                    │  3. Row Lock       │                    │                   │
     │                    │ <──────────────────│                    │                   │
     │                    │                    │                    │                   │
     │                    │  4. UPDATE seats   │                    │                   │
     │                    │     SET status,    │                    │                   │
     │                    │     version++      │                    │                   │
     │                    │ ──────────────────>│                    │                   │
     │                    │                    │                    │                   │
     │                    │  5. INSERT booking │                    │                   │
     │                    │ ──────────────────>│                    │                   │
     │                    │                    │                    │                   │
     │                    │  6. COMMIT         │                    │                   │
     │                    │ ──────────────────>│                    │                   │
     │                    │                    │                    │                   │
     │                    │  7. Committed ✓    │                    │                   │
     │                    │ <──────────────────│                    │                   │
     │                    │                    │                    │                   │
     │  8. Success        │                    │                    │                   │
     │     Response       │                    │                    │                   │
     │ <──────────────────│                    │                    │                   │
     │                    │                    │                    │                   │
     │                    │  9. Publish Event  │                    │                   │
     │                    │    (async, fire &  │                    │                   │
     │                    │     forget w/retry)│                    │                   │
     │                    │ ──────────────────────────────────────>│                   │
     │                    │                    │                    │                   │
     │                    │                    │                    │ 10. Consume Event │
     │                    │                    │                    │ ─────────────────>│
     │                    │                    │                    │                   │
     │                    │                    │                    │                   │
     │ 11. SSE: seat.booked                    │                    │                   │
     │ <───────────────────────────────────────────────────────────────────────────────│
     │                    │                    │                    │                   │
     ▼                    ▼                    ▼                    ▼                   ▼
```

---

## 4. Why Kafka is NOT Used for Validation

### What Kafka Does:
1. **Decouples write acknowledgment from broadcast** - Client gets response immediately
2. **Enables multiple consumers** - Analytics, notifications, audit logs
3. **Provides durability** - Events survive service restarts
4. **Scales horizontally** - Partition by event_id for locality

### What Kafka Does NOT Do:
1. ❌ Validate bookings
2. ❌ Enforce constraints
3. ❌ Act as source of truth
4. ❌ Participate in transaction

### Why This Matters:
```
WRONG: Client → Kafka → Consumer validates → DB
       (Race conditions, lost updates, eventual consistency nightmares)

RIGHT: Client → DB Transaction → Success → Kafka → Broadcast
       (Consistency guaranteed, Kafka is just a notification pipe)
```

---

## 5. Client State Management Strategy

### Three-Layer State Model:

```typescript
// Layer 1: Server Cache (React Query / SWR)
// - Fetched from server
// - Stale-while-revalidate pattern
// - Invalidated by SSE events

// Layer 2: Optimistic Updates Queue
// - Pending mutations with rollback functions
// - Keyed by operation ID
// - Cleared on server confirmation

// Layer 3: Real-time Overlay
// - SSE events applied on top
// - Only for OTHER users' changes
// - Own changes already confirmed via Layer 2
```

### Why Client is Never Source of Truth:

1. **Network partitions**: Client may miss SSE events
2. **Stale data**: Multiple tabs, browser caches
3. **Race conditions**: Two clients booking simultaneously
4. **Malicious clients**: Can't trust client-side validation

The server response to your booking request is the ONLY authoritative confirmation.

---

## 6. Optimistic UI with Guaranteed Rollback

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     OPTIMISTIC UPDATE LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. User clicks "Book Seat A1"                                          │
│     │                                                                    │
│     ▼                                                                    │
│  2. Generate optimisticId = uuid()                                      │
│     │                                                                    │
│     ▼                                                                    │
│  3. Store rollback state: { seatId: 'A1', previousStatus: 'available' } │
│     │                                                                    │
│     ▼                                                                    │
│  4. Update UI immediately: Seat A1 → 'pending' (shown as "Booking...")  │
│     │                                                                    │
│     ▼                                                                    │
│  5. Call server action with optimisticId                                │
│     │                                                                    │
│     ├─────────────────────┬─────────────────────────────────────────────│
│     │                     │                                              │
│     ▼                     ▼                                              │
│  SUCCESS                 FAILURE                                         │
│     │                     │                                              │
│     ▼                     ▼                                              │
│  6a. Server returns      6b. Server returns error                       │
│      { success: true,        { success: false,                          │
│        booking: {...} }        error: 'SEAT_TAKEN' }                    │
│     │                     │                                              │
│     ▼                     ▼                                              │
│  7a. Clear rollback      7b. Execute rollback:                          │
│      state                   Seat A1 → 'available'                      │
│     │                     │                                              │
│     ▼                     ▼                                              │
│  8a. Update UI:          8b. Show error toast:                          │
│      Seat A1 → 'booked'      "Seat already taken"                       │
│      (confirmed)          │                                              │
│     │                     │                                              │
│     ▼                     ▼                                              │
│  9. SSE event arrives    9. SSE event arrives showing                   │
│     (ignored - already       real owner of seat                         │
│      up to date)                                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Guaranteed Correctness Summary

| Guarantee | Mechanism |
|-----------|-----------|
| No double booking | UNIQUE constraint on (seat_id) WHERE status = 'booked' |
| No lost updates | Optimistic locking with version column |
| Serialized access | SELECT ... FOR UPDATE row locking |
| ACID transactions | PostgreSQL transaction isolation |
| Eventual consistency for reads | Kafka → SSE broadcast |
| Client correctness | Server response always authoritative |
| No split-brain | Single database, single write path |

---

## 8. Scalability Considerations

### Horizontal Scaling:
- **Next.js**: Stateless, scale behind load balancer
- **PostgreSQL**: Read replicas for queries, single primary for writes
- **Kafka**: Partition by event_id, consumer groups per service
- **SSE/WebSocket**: Redis pub/sub for cross-instance broadcast

### Bottleneck Analysis:
- **Write path**: Limited by PostgreSQL write throughput
- **Mitigation**: Connection pooling (PgBouncer), prepared statements
- **Real-world**: ~10,000 bookings/second achievable with proper tuning

### Hot Seat Problem:
- Many users clicking same seat simultaneously
- Row lock serializes updates - first one wins, others fail fast
- No retry storms - immediate failure response

---

## Next Steps

See the following files for implementation details:
- `database/schema.sql` - PostgreSQL schemas
- `src/lib/db/` - Database client and transactions
- `src/actions/` - Server actions (single write path)
- `src/lib/kafka/` - Kafka producer/consumer
- `src/lib/realtime/` - SSE broadcast service
- `src/hooks/` - Client-side state management
- `RACE_CONDITION_WALKTHROUGH.md` - Detailed race condition analysis
