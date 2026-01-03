// ============================================================================
// SSE (SERVER-SENT EVENTS) API ROUTE
// ============================================================================
//
// This route establishes SSE connections for real-time seat updates.
//
// Endpoint: GET /api/sse?eventId=<uuid>
//
// The connection:
// 1. Receives real-time seat status changes for the specified event
// 2. Includes isCurrentUser flag for the client's own actions
// 3. Stays open until client disconnects or server closes it
//
// ============================================================================

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  registerConnection,
  unregisterConnection,
  sendPing,
} from '@/lib/realtime/broadcaster';

// Disable response caching for SSE
export const dynamic = 'force-dynamic';

// ----------------------------------------------------------------------------
// SSE Connection Handler
// ----------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  // ========================================================================
  // Step 1: Validate request
  // ========================================================================
  const eventId = request.nextUrl.searchParams.get('eventId');

  if (!eventId) {
    return new Response('Missing eventId parameter', { status: 400 });
  }

  // Validate UUID format, unless it's the special 'admin' channel
  if (eventId !== 'admin') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return new Response('Invalid eventId format', { status: 400 });
    }
  }

  // ========================================================================
  // Step 2: Get current user (optional - anonymous viewing allowed)
  // ========================================================================
  let userId: string | null = null;

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session_user_id');

    if (sessionCookie) {
      userId = sessionCookie.value;
    }
  } catch {
    // Anonymous connection - that's fine
  }

  // ========================================================================
  // Step 3: Create SSE stream
  // ========================================================================
  const connectionId = crypto.randomUUID();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Register this connection
      registerConnection(connectionId, userId, eventId, controller);

      // Send initial connection confirmation
      const welcomeMessage =
        `event: connected\n` +
        `data: ${JSON.stringify({
          connectionId,
          eventId,
          userId: userId ? 'authenticated' : 'anonymous',
          timestamp: new Date().toISOString(),
        })}\n\n`;

      controller.enqueue(new TextEncoder().encode(welcomeMessage));

      // Set up periodic ping to keep connection alive
      const pingInterval = setInterval(() => {
        const success = sendPing(connectionId);
        if (!success) {
          clearInterval(pingInterval);
        }
      }, 30000); // Ping every 30 seconds

      // Store interval reference for cleanup
      (controller as unknown as { pingInterval: NodeJS.Timeout }).pingInterval = pingInterval;
    },

    cancel() {
      // Client disconnected
      console.log(`SSE client disconnected: ${connectionId}`);
      unregisterConnection(connectionId);
    },
  });

  // ========================================================================
  // Step 4: Return SSE response
  // ========================================================================
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Allow CORS for development
      'Access-Control-Allow-Origin': '*',
      // Disable buffering (important for nginx/proxies)
      'X-Accel-Buffering': 'no',
    },
  });
}

// ----------------------------------------------------------------------------
// Example Client Usage (TypeScript)
// ----------------------------------------------------------------------------

/*
// React hook for SSE connection
function useSeatUpdates(eventId: string) {
  const [seats, setSeats] = useState<Map<string, SeatMapItem>>(new Map());

  useEffect(() => {
    const eventSource = new EventSource(`/api/sse?eventId=${eventId}`);

    eventSource.addEventListener('connected', (e) => {
      console.log('SSE connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('seat.booked', (e) => {
      const event = JSON.parse(e.data);
      setSeats((prev) => {
        const next = new Map(prev);
        const seat = next.get(event.payload.seatId);
        if (seat) {
          next.set(event.payload.seatId, {
            ...seat,
            status: 'booked',
          });
        }
        return next;
      });
    });

    eventSource.addEventListener('seat.held', (e) => {
      const event = JSON.parse(e.data);
      // Update seat status...
    });

    eventSource.addEventListener('seat.released', (e) => {
      const event = JSON.parse(e.data);
      // Update seat status...
    });

    eventSource.onerror = (e) => {
      console.error('SSE error:', e);
      // Implement reconnection logic
    };

    return () => {
      eventSource.close();
    };
  }, [eventId]);

  return seats;
}
*/
