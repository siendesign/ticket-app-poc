// ============================================================================
// KAFKA PRODUCER
// ============================================================================
//
// This module publishes booking events to Kafka AFTER successful DB commits.
//
// Key principles:
// 1. Events are published AFTER the database transaction commits
// 2. Events are fire-and-forget with retry - DB is source of truth
// 3. If Kafka is down, bookings still succeed (events are lost until recovery)
// 4. A reconciliation process can detect/replay missed events if needed
//
// ============================================================================

import { Kafka, Producer, Partitioners, CompressionTypes } from 'kafkajs';
import type { KafkaBookingEvent } from '@/types';

// ----------------------------------------------------------------------------
// Kafka Client Configuration
// ----------------------------------------------------------------------------

const kafka = new Kafka({
  clientId: 'ticketing-app',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),

  // Authentication (for production)
  ...(process.env.KAFKA_SASL_USERNAME && {
    sasl: {
      mechanism: 'plain',
      username: process.env.KAFKA_SASL_USERNAME,
      password: process.env.KAFKA_SASL_PASSWORD || '',
    },
    ssl: true,
  }),

  // Retry configuration
  retry: {
    initialRetryTime: 100,
    retries: 8,
    maxRetryTime: 30000,
    factor: 2,
  },

  // Connection timeout
  connectionTimeout: 10000,
  requestTimeout: 30000,
});

// ----------------------------------------------------------------------------
// Producer Singleton
// ----------------------------------------------------------------------------

let producer: Producer | null = null;
let isConnecting = false;

/**
 * Get or create the Kafka producer
 *
 * Uses lazy initialization to avoid startup delays
 */
async function getProducer(): Promise<Producer> {
  if (producer) {
    return producer;
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    await new Promise((resolve) => setTimeout(resolve, 100));
    return getProducer();
  }

  isConnecting = true;

  try {
    producer = kafka.producer({
      // Use default partitioner which hashes the key
      createPartitioner: Partitioners.DefaultPartitioner,

      // Transaction support (optional, for exactly-once semantics)
      // transactionalId: 'ticketing-producer',

      // Idempotent producer - prevents duplicates on retry
      // Disabled to debug connection issues
      idempotent: false,

      // Require all replicas to acknowledge (strongest durability)
      // Note: This is set per-message, not here
    });

    await producer.connect();
    console.log('Kafka producer connected');

    // Handle disconnections
    producer.on('producer.disconnect', () => {
      console.warn('Kafka producer disconnected');
      producer = null;
    });

    return producer;
  } catch (error) {
    console.error('Failed to connect Kafka producer:', error);
    throw error;
  } finally {
    isConnecting = false;
  }
}

// ----------------------------------------------------------------------------
// Topic Configuration
// ----------------------------------------------------------------------------

const TOPICS = {
  BOOKING_EVENTS: 'booking-events',
  SEAT_STATUS_CHANGES: 'seat-status-changes',
} as const;

// ----------------------------------------------------------------------------
// Event Publishing
// ----------------------------------------------------------------------------

/**
 * Publish a booking event to Kafka
 *
 * This function is called AFTER a successful database commit.
 * It uses fire-and-forget semantics with automatic retry.
 *
 * @param event - The booking event to publish
 *
 * @example
 * // After successful booking commit
 * await publishBookingEvent({
 *   type: 'seat.booked',
 *   version: '1.0',
 *   timestamp: new Date().toISOString(),
 *   traceId: 'request-uuid',
 *   payload: {
 *     eventId: 'event-uuid',
 *     seatId: 'seat-uuid',
 *     userId: 'user-uuid',
 *     previousStatus: 'available',
 *     newStatus: 'booked',
 *     bookingId: 'booking-uuid',
 *     metadata: { ... }
 *   }
 * });
 */
export async function publishBookingEvent(
  event: KafkaBookingEvent
): Promise<void> {
  const prod = await getProducer();

  // Use eventId as partition key - ensures all events for same event
  // go to same partition, maintaining order
  const key = event.payload.eventId;

  await prod.send({
    topic: TOPICS.BOOKING_EVENTS,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key,
        value: JSON.stringify(event),
        headers: {
          'event-type': event.type,
          'event-version': event.version,
          'trace-id': event.traceId,
        },
      },
    ],
    // Wait for leader acknowledgment (good balance of durability/speed)
    acks: -1, // Use -1 for 'all' replicas if you need strongest durability
  });

  console.log(`Published ${event.type} event for seat ${event.payload.seatId}`);
}

/**
 * Publish multiple events in a batch
 *
 * More efficient than individual publishes for bulk operations
 */
export async function publishBookingEventBatch(
  events: KafkaBookingEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const prod = await getProducer();

  await prod.send({
    topic: TOPICS.BOOKING_EVENTS,
    compression: CompressionTypes.GZIP,
    messages: events.map((event) => ({
      key: event.payload.eventId,
      value: JSON.stringify(event),
      headers: {
        'event-type': event.type,
        'event-version': event.version,
        'trace-id': event.traceId,
      },
    })),
    acks: -1,
  });

  console.log(`Published batch of ${events.length} events`);
}

// ----------------------------------------------------------------------------
// Graceful Shutdown
// ----------------------------------------------------------------------------

/**
 * Disconnect the producer (call on app shutdown)
 */
export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    console.log('Kafka producer disconnected');
  }
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGTERM', disconnectProducer);
  process.on('SIGINT', disconnectProducer);
}
