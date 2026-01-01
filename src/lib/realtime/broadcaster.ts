// ============================================================================
// REAL-TIME BROADCASTER
// ============================================================================
//
// This module manages SSE connections and broadcasts events to clients.
//
// Architecture:
// - Each client connects via SSE to receive real-time updates
// - Connections are grouped by eventId (the concert/show they're viewing)
// - When a booking event occurs, it's broadcast to all viewers of that event
// - For multi-instance deployments, Redis pub/sub coordinates across servers
//
// Key principles:
// 1. Real-time is PROPAGATION ONLY - never writes to database
// 2. Clients cannot trust SSE data as authoritative
// 3. SSE events include isCurrentUser flag for UI optimization
//
// ============================================================================

import { UUID, RealtimeEvent, SeatStatusChangePayload } from '@/types';

// ----------------------------------------------------------------------------
// Connection Registry
// ----------------------------------------------------------------------------

interface ClientConnection {
  id: string;
  userId: UUID | null;       // null for anonymous viewers
  eventId: UUID;             // Which event they're watching
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
  lastPingAt: Date;
}

// In-memory connection store
// Singleton pattern to handle Next.js module duplication
const globalForBroadcaster = globalThis as unknown as {
  connections: Map<string, ClientConnection>;
  connectionsByEvent: Map<UUID, Set<string>>;
  globalConnections: Set<string>;
};

const connections = globalForBroadcaster.connections || new Map<string, ClientConnection>();
const connectionsByEvent = globalForBroadcaster.connectionsByEvent || new Map<UUID, Set<string>>();
const globalConnections = globalForBroadcaster.globalConnections || new Set<string>();

if (process.env.NODE_ENV !== 'production') {
  globalForBroadcaster.connections = connections;
  globalForBroadcaster.connectionsByEvent = connectionsByEvent;
  globalForBroadcaster.globalConnections = globalConnections;
}

// ----------------------------------------------------------------------------
// Connection Management
// ----------------------------------------------------------------------------

/**
 * Register a new SSE connection
 *
 * @param connectionId - Unique ID for this connection
 * @param userId - User ID if authenticated, null otherwise
 * @param eventId - The event (concert) the client is viewing
 * @param controller - Stream controller for sending events
 */
export function registerConnection(
  connectionId: string,
  userId: UUID | null,
  eventId: UUID,
  controller: ReadableStreamDefaultController
): void {
  const connection: ClientConnection = {
    id: connectionId,
    userId,
    eventId,
    controller,
    connectedAt: new Date(),
    lastPingAt: new Date(),
  };

  connections.set(connectionId, connection);

  // Add to indices
  if (eventId === 'admin' as UUID) {
    globalConnections.add(connectionId);
    console.log(`SSE connection registered as GLOBAL/ADMIN: ${connectionId}`);
  } else {
    if (!connectionsByEvent.has(eventId)) {
      connectionsByEvent.set(eventId, new Set());
    }
    connectionsByEvent.get(eventId)!.add(connectionId);
    console.log(`SSE connection registered: ${connectionId} for event ${eventId}`);
  }

  console.log(`Total active connections: ${connections.size}`);
}

/**
 * Remove a connection when client disconnects
 */
export function unregisterConnection(connectionId: string): void {
  const connection = connections.get(connectionId);
  if (!connection) return;

  // Remove from index
  if (connection.eventId === 'admin' as UUID) {
    globalConnections.delete(connectionId);
  } else {
    const eventConnections = connectionsByEvent.get(connection.eventId);
    if (eventConnections) {
      eventConnections.delete(connectionId);
      if (eventConnections.size === 0) {
        connectionsByEvent.delete(connection.eventId);
      }
    }
  }

  connections.delete(connectionId);

  console.log(
    `SSE connection removed: ${connectionId}`,
    `(total: ${connections.size})`
  );
}

/**
 * Update last ping time for a connection
 */
export function pingConnection(connectionId: string): void {
  const connection = connections.get(connectionId);
  if (connection) {
    connection.lastPingAt = new Date();
  }
}

// ----------------------------------------------------------------------------
// Broadcasting
// ----------------------------------------------------------------------------

/**
 * Broadcast an event to all clients viewing a specific event
 *
 * @param eventId - The event (concert) to broadcast to
 * @param event - The real-time event to send
 * @param actorUserId - The user who performed the action (for isCurrentUser flag)
 */
export async function broadcastToEvent(
  eventId: UUID,
  event: RealtimeEvent<SeatStatusChangePayload>,
  actorUserId?: UUID
): Promise<void> {
  const eventConnections = connectionsByEvent.get(eventId) || new Set<string>();
  const allTargetConnections = new Set([...eventConnections, ...globalConnections]);

  if (allTargetConnections.size === 0) {
    console.log(`No connections for event ${eventId} (including globals), skipping broadcast`);
    return;
  }

  console.log(`Broadcasting ${event.type} to ${allTargetConnections.size} connections (Event: ${eventConnections.size}, Global: ${globalConnections.size})`);

  const failedConnections: string[] = [];

  for (const connectionId of allTargetConnections) {
    const connection = connections.get(connectionId);
    if (!connection) continue;

    try {
      // Add isCurrentUser flag if this client is the actor
      const personalizedEvent = {
        ...event,
        payload: {
          ...event.payload,
          isCurrentUser: actorUserId ? connection.userId === actorUserId : false,
        },
      };

      // Format as SSE message
      const sseMessage = formatSSEMessage(personalizedEvent);

      // Send to client
      connection.controller.enqueue(new TextEncoder().encode(sseMessage));
    } catch (error) {
      console.error(`Failed to send to connection ${connectionId}:`, error);
      failedConnections.push(connectionId);
    }
  }

  // Clean up failed connections
  for (const connectionId of failedConnections) {
    unregisterConnection(connectionId);
  }
}

/**
 * Broadcast to a specific user across all their connections
 *
 * Useful for sending personal notifications (booking confirmations, etc.)
 */
export async function broadcastToUser(
  userId: UUID,
  event: RealtimeEvent
): Promise<void> {
  for (const [connectionId, connection] of connections) {
    if (connection.userId !== userId) continue;

    try {
      const sseMessage = formatSSEMessage(event);
      connection.controller.enqueue(new TextEncoder().encode(sseMessage));
    } catch (error) {
      console.error(`Failed to send to user connection ${connectionId}:`, error);
      unregisterConnection(connectionId);
    }
  }
}

/**
 * Broadcast to ALL connections (use sparingly - e.g., system announcements)
 */
export async function broadcastGlobal(event: RealtimeEvent): Promise<void> {
  console.log(`Broadcasting global event to ${connections.size} connections`);

  const failedConnections: string[] = [];
  const sseMessage = formatSSEMessage(event);
  const encoded = new TextEncoder().encode(sseMessage);

  for (const [connectionId, connection] of connections) {
    try {
      connection.controller.enqueue(encoded);
    } catch (error) {
      failedConnections.push(connectionId);
    }
  }

  for (const connectionId of failedConnections) {
    unregisterConnection(connectionId);
  }
}

// ----------------------------------------------------------------------------
// SSE Message Formatting
// ----------------------------------------------------------------------------

/**
 * Format a message as SSE
 *
 * SSE format:
 * event: <event-type>
 * data: <json-data>
 * id: <optional-id>
 *
 */
function formatSSEMessage(event: RealtimeEvent, id?: string): string {
  let message = '';

  // Event type
  message += `event: ${event.type}\n`;

  // Optional ID for client-side deduplication
  if (id) {
    message += `id: ${id}\n`;
  }

  // Data payload
  message += `data: ${JSON.stringify(event)}\n`;

  // Empty line to end message
  message += '\n';

  return message;
}

/**
 * Send a ping/heartbeat to keep connection alive
 */
export function sendPing(connectionId: string): boolean {
  const connection = connections.get(connectionId);
  if (!connection) return false;

  try {
    const pingMessage = `: ping\n\n`;
    connection.controller.enqueue(new TextEncoder().encode(pingMessage));
    connection.lastPingAt = new Date();
    return true;
  } catch {
    unregisterConnection(connectionId);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Connection Health & Cleanup
// ----------------------------------------------------------------------------

/**
 * Get statistics about current connections
 */
export function getConnectionStats(): {
  totalConnections: number;
  connectionsByEvent: Record<string, number>;
  oldestConnection: Date | null;
} {
  const stats: Record<string, number> = {};

  for (const [eventId, conns] of connectionsByEvent) {
    stats[eventId] = conns.size;
  }

  let oldest: Date | null = null;
  for (const conn of connections.values()) {
    if (!oldest || conn.connectedAt < oldest) {
      oldest = conn.connectedAt;
    }
  }

  return {
    totalConnections: connections.size,
    connectionsByEvent: stats,
    oldestConnection: oldest,
  };
}

/**
 * Clean up stale connections
 *
 * Should be called periodically (e.g., every minute)
 */
export function cleanupStaleConnections(maxAgeMs: number = 300000): number {
  const now = Date.now();
  const staleConnections: string[] = [];

  for (const [connectionId, connection] of connections) {
    const age = now - connection.lastPingAt.getTime();
    if (age > maxAgeMs) {
      staleConnections.push(connectionId);
    }
  }

  for (const connectionId of staleConnections) {
    unregisterConnection(connectionId);
  }

  if (staleConnections.length > 0) {
    console.log(`Cleaned up ${staleConnections.length} stale connections`);
  }

  return staleConnections.length;
}

// ----------------------------------------------------------------------------
// Multi-Instance Support (Redis Pub/Sub)
// ----------------------------------------------------------------------------

/*
For production deployments with multiple server instances, you need to
coordinate broadcasts across all instances. Here's how:

1. When an event occurs, publish to Redis pub/sub channel instead of
   directly broadcasting

2. Each instance subscribes to the Redis channel and broadcasts to
   its local connections

Example implementation:

import { createClient } from 'redis';

const redisPublisher = createClient();
const redisSubscriber = createClient();

// Publish (instead of direct broadcast)
async function publishToRedis(eventId: UUID, event: RealtimeEvent, actorUserId?: UUID) {
  await redisPublisher.publish('seat-events', JSON.stringify({
    eventId,
    event,
    actorUserId,
  }));
}

// Subscribe (in each instance)
async function subscribeToRedis() {
  await redisSubscriber.subscribe('seat-events', (message) => {
    const { eventId, event, actorUserId } = JSON.parse(message);
    broadcastToEvent(eventId, event, actorUserId);
  });
}

This ensures all connected clients receive events regardless of which
server instance they're connected to.
*/
