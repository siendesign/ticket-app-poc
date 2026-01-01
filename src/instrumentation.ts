// ============================================================================
// NEXT.JS INSTRUMENTATION
// ============================================================================
//
// This file runs once when the Next.js server starts.
// We use it to initialize the Kafka consumer so it runs in the same
// process as the Next.js server, sharing memory with SSE connections.
//
// Documentation: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// ============================================================================

export async function register() {
  console.log('[Instrumentation] Register called, runtime:', process.env.NEXT_RUNTIME, 'PID:', process.pid);
  
  // Only run on the server (not in edge runtime or client)
  // In development, this runs in the Node.js runtime
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    console.log('[Instrumentation] Initializing Kafka consumer...');
    
    try {
      // Dynamically import to avoid bundling issues
      const { startConsumer } = await import('@/lib/kafka/consumer');
      
      // Start the consumer
      await startConsumer();
      
      console.log('[Instrumentation] ✓ Kafka consumer started successfully');
    } catch (error) {
      console.error('[Instrumentation] ✗ Failed to start Kafka consumer:', error);
      // Don't crash the server if Kafka is unavailable
      // The app can still function without real-time updates
      console.warn('[Instrumentation] Server will continue without real-time Kafka updates');
    }
  } else {
    console.log('[Instrumentation] Skipping Kafka consumer (not in nodejs runtime), PID:', process.pid);
  }
}

