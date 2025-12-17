// ============================================================================
// KAFKA CONSUMER - BROADCAST SERVICE
// ============================================================================
//
// This service consumes booking events from Kafka and broadcasts them
// to connected clients via SSE/WebSocket.
//
// Key principles:
// 1. Consumes COMMITTED events only (after DB transaction success)
// 2. Does NOT validate or modify data - just propagates
// 3. Idempotent processing - same event can be replayed safely
// 4. Maintains consumer group for horizontal scaling
//
// ============================================================================

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { broadcastToEvent } from '@/lib/realtime/broadcaster';
import type { KafkaBookingEvent, RealtimeEvent, SeatStatusChangePayload } from '@/types';

// ----------------------------------------------------------------------------
// Kafka Client Configuration
// ----------------------------------------------------------------------------

const kafka = new Kafka({
  clientId: 'ticketing-broadcast-service',
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

  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

// ----------------------------------------------------------------------------
// Consumer Configuration
// ----------------------------------------------------------------------------

const CONSUMER_GROUP_ID = 'broadcast-service';
const TOPIC = 'booking-events';

let consumer: Consumer | null = null;
let isRunning = false;

// ----------------------------------------------------------------------------
// Message Handler
// ----------------------------------------------------------------------------

/**
 * Process a single Kafka message
 *
 * This transforms Kafka events into real-time broadcast messages
 * and sends them to all connected clients viewing the relevant event.
 */
async function handleMessage({ message, partition, topic }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    console.warn('Received empty message');
    return;
  }

  try {
    const event: KafkaBookingEvent = JSON.parse(message.value.toString());

    console.log(
      `Processing ${event.type} from partition ${partition}:`,
      `seat=${event.payload.seatId}, event=${event.payload.eventId}`
    );

    // Transform Kafka event to real-time broadcast format
    const realtimeEvent: RealtimeEvent<SeatStatusChangePayload> = {
      type: mapEventType(event.type),
      eventId: event.payload.eventId,
      timestamp: event.timestamp,
      payload: {
        seatId: event.payload.seatId,
        previousStatus: event.payload.previousStatus,
        newStatus: event.payload.newStatus,
        displayLabel: event.payload.metadata.displayLabel,
        // Note: userId is intentionally NOT included for privacy
        // Clients only see their own actions via the isCurrentUser flag
      },
    };

    // Broadcast to all clients watching this event
    await broadcastToEvent(event.payload.eventId, realtimeEvent, event.payload.userId);

    // Log successful processing
    console.log(
      `Broadcast ${event.type} for seat ${event.payload.metadata.displayLabel}`
    );
  } catch (error) {
    // Log but don't throw - we don't want to stop the consumer
    // In production, send to dead letter queue for investigation
    console.error('Failed to process message:', error, {
      topic,
      partition,
      offset: message.offset,
    });
  }
}

/**
 * Map Kafka event types to real-time event types
 */
function mapEventType(kafkaType: KafkaBookingEvent['type']): RealtimeEvent['type'] {
  const mapping: Record<KafkaBookingEvent['type'], RealtimeEvent['type']> = {
    'seat.booked': 'seat.booked',
    'seat.released': 'seat.released',
    'seat.held': 'seat.held',
    'seat.expired': 'seat.expired',
  };
  return mapping[kafkaType];
}

// ----------------------------------------------------------------------------
// Consumer Lifecycle
// ----------------------------------------------------------------------------

/**
 * Start the Kafka consumer
 *
 * This should be called once when the broadcast service starts.
 */
export async function startConsumer(): Promise<void> {
  if (isRunning) {
    console.warn('Consumer is already running');
    return;
  }

  consumer = kafka.consumer({
    groupId: CONSUMER_GROUP_ID,

    // Session timeout - if no heartbeat within this time, consumer is considered dead
    sessionTimeout: 30000,

    // Heartbeat interval
    heartbeatInterval: 3000,

    // How often to commit offsets
    // Using auto-commit for simplicity; manual commit for more control
    // autoCommit: true,
    // autoCommitInterval: 5000,

    // Max records per poll
    maxBytesPerPartition: 1048576, // 1MB
  });

  // Handle crashes
  consumer.on('consumer.crash', ({ payload: { error } }) => {
    console.error('Consumer crashed:', error);
    // In production: alert, restart, etc.
  });

  // Handle rebalances (partitions being reassigned)
  consumer.on('consumer.rebalancing', () => {
    console.log('Consumer is rebalancing...');
  });

  consumer.on('consumer.group_join', ({ payload: { memberAssignment } }) => {
    console.log('Consumer joined group, assigned partitions:', memberAssignment);
  });

  await consumer.connect();
  console.log('Kafka consumer connected');

  await consumer.subscribe({
    topic: TOPIC,
    fromBeginning: false, // Only consume new messages
  });
  console.log(`Subscribed to topic: ${TOPIC}`);

  isRunning = true;

  // Start consuming
  await consumer.run({
    // Process one message at a time for simplicity
    // For higher throughput, use eachBatch
    eachMessage: handleMessage,
  });

  console.log('Kafka consumer is running');
}

/**
 * Stop the Kafka consumer
 *
 * Call this on graceful shutdown.
 */
export async function stopConsumer(): Promise<void> {
  if (!consumer || !isRunning) {
    return;
  }

  isRunning = false;

  try {
    await consumer.stop();
    await consumer.disconnect();
    consumer = null;
    console.log('Kafka consumer stopped');
  } catch (error) {
    console.error('Error stopping consumer:', error);
  }
}

// ----------------------------------------------------------------------------
// Consumer Health Check
// ----------------------------------------------------------------------------

/**
 * Check if the consumer is healthy and processing messages
 */
export function isConsumerHealthy(): boolean {
  return isRunning && consumer !== null;
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGTERM', stopConsumer);
  process.on('SIGINT', stopConsumer);
}

// ----------------------------------------------------------------------------
// Example Event Payloads (Documentation)
// ----------------------------------------------------------------------------

/*
Example Kafka message for seat.booked:

{
  "type": "seat.booked",
  "version": "1.0",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "eventId": "33333333-3333-3333-3333-333333333333",
    "seatId": "44444444-4444-4444-4444-444444444444",
    "userId": "11111111-1111-1111-1111-111111111111",
    "previousStatus": "available",
    "newStatus": "booked",
    "bookingId": "55555555-5555-5555-5555-555555555555",
    "metadata": {
      "section": "A",
      "rowName": "1",
      "seatNumber": "5",
      "displayLabel": "A-1-5",
      "priceCents": 7500
    }
  }
}

Example Kafka message for seat.held:

{
  "type": "seat.held",
  "version": "1.0",
  "timestamp": "2025-01-15T10:29:00.000Z",
  "traceId": "660e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "eventId": "33333333-3333-3333-3333-333333333333",
    "seatId": "44444444-4444-4444-4444-444444444444",
    "userId": "11111111-1111-1111-1111-111111111111",
    "previousStatus": "available",
    "newStatus": "held",
    "metadata": {
      "section": "A",
      "rowName": "1",
      "seatNumber": "5",
      "displayLabel": "A-1-5"
    }
  }
}

Example Kafka message for seat.released:

{
  "type": "seat.released",
  "version": "1.0",
  "timestamp": "2025-01-15T10:35:00.000Z",
  "traceId": "770e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "eventId": "33333333-3333-3333-3333-333333333333",
    "seatId": "44444444-4444-4444-4444-444444444444",
    "userId": "11111111-1111-1111-1111-111111111111",
    "previousStatus": "held",
    "newStatus": "available",
    "metadata": {
      "section": "A",
      "rowName": "1",
      "seatNumber": "5",
      "displayLabel": "A-1-5"
    }
  }
}

Example Kafka message for seat.expired (system-generated):

{
  "type": "seat.expired",
  "version": "1.0",
  "timestamp": "2025-01-15T10:40:00.000Z",
  "traceId": "880e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "eventId": "33333333-3333-3333-3333-333333333333",
    "seatId": "44444444-4444-4444-4444-444444444444",
    "userId": "11111111-1111-1111-1111-111111111111",
    "previousStatus": "held",
    "newStatus": "available",
    "metadata": {
      "section": "A",
      "rowName": "1",
      "seatNumber": "5",
      "displayLabel": "A-1-5"
    }
  }
}
*/
