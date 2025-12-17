// ============================================================================
// DATABASE CLIENT WITH TRANSACTION SUPPORT
// ============================================================================
//
// This module provides:
// 1. Connection pooling via pg Pool
// 2. Transaction helpers with automatic rollback
// 3. Typed query execution
// 4. Optimistic locking utilities
//
// ============================================================================

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// ----------------------------------------------------------------------------
// Connection Pool Configuration
// ----------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'ticketing',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',

  // Pool configuration for production
  max: parseInt(process.env.POSTGRES_POOL_MAX || '20'),
  min: parseInt(process.env.POSTGRES_POOL_MIN || '5'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,

  // Enable statement timeout to prevent long-running queries
  statement_timeout: 30000, // 30 seconds
});

// Log pool errors (don't crash the process)
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// ----------------------------------------------------------------------------
// Query Execution
// ----------------------------------------------------------------------------

/**
 * Execute a single query using a connection from the pool
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    // Log slow queries in development
    if (process.env.NODE_ENV === 'development' && duration > 100) {
      console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
    }

    return result;
  } catch (error) {
    console.error('Query error:', { text: text.substring(0, 200), error });
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Transaction Support
// ----------------------------------------------------------------------------

/**
 * Transaction isolation levels
 */
export type IsolationLevel =
  | 'READ COMMITTED'      // Default - sees committed changes from other txns
  | 'REPEATABLE READ'     // Snapshot isolation - consistent view throughout txn
  | 'SERIALIZABLE';       // Strictest - as if transactions ran serially

/**
 * Transaction context passed to the callback
 */
export interface TransactionContext {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ) => Promise<QueryResult<T>>;
  client: PoolClient;
}

/**
 * Execute a function within a database transaction
 *
 * Features:
 * - Automatic BEGIN/COMMIT/ROLLBACK
 * - Connection automatically released back to pool
 * - Configurable isolation level
 * - Supports optimistic locking pattern
 *
 * @example
 * const booking = await withTransaction(async (tx) => {
 *   // All queries here are in the same transaction
 *   const seat = await tx.query('SELECT * FROM seats WHERE id = $1 FOR UPDATE', [seatId]);
 *   // ... validate and update ...
 *   return booking;
 * });
 */
export async function withTransaction<T>(
  callback: (ctx: TransactionContext) => Promise<T>,
  options: {
    isolationLevel?: IsolationLevel;
    readOnly?: boolean;
  } = {}
): Promise<T> {
  const client = await pool.connect();
  const { isolationLevel = 'READ COMMITTED', readOnly = false } = options;

  try {
    // Start transaction with specified isolation level
    let beginStatement = 'BEGIN';
    if (isolationLevel !== 'READ COMMITTED' || readOnly) {
      beginStatement = `BEGIN ISOLATION LEVEL ${isolationLevel}`;
      if (readOnly) {
        beginStatement += ' READ ONLY';
      }
    }
    await client.query(beginStatement);

    // Create transaction context
    const ctx: TransactionContext = {
      query: async <T extends QueryResultRow = QueryResultRow>(
        text: string,
        params?: unknown[]
      ): Promise<QueryResult<T>> => {
        return client.query<T>(text, params);
      },
      client,
    };

    // Execute the callback
    const result = await callback(ctx);

    // Commit if successful
    await client.query('COMMIT');

    return result;
  } catch (error) {
    // Rollback on any error
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Always release the client back to the pool
    client.release();
  }
}

// ----------------------------------------------------------------------------
// Optimistic Locking Utilities
// ----------------------------------------------------------------------------

/**
 * Error thrown when optimistic lock fails (version mismatch)
 */
export class OptimisticLockError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion?: number
  ) {
    super(
      `Optimistic lock failed for ${entityType} ${entityId}: ` +
        `expected version ${expectedVersion}, got ${actualVersion ?? 'unknown'}`
    );
    this.name = 'OptimisticLockError';
  }
}

/**
 * Result of an optimistic update operation
 */
export interface OptimisticUpdateResult<T> {
  success: boolean;
  data?: T;
  currentVersion?: number;
}

/**
 * Execute an UPDATE with optimistic locking
 *
 * @example
 * const result = await optimisticUpdate(
 *   'seats',
 *   seatId,
 *   expectedVersion,
 *   `UPDATE seats
 *    SET status = $3, version = version + 1, updated_at = NOW()
 *    WHERE id = $1 AND version = $2
 *    RETURNING *`,
 *   [seatId, expectedVersion, 'booked']
 * );
 */
export async function optimisticUpdate<T extends QueryResultRow>(
  ctx: TransactionContext,
  entityType: string,
  entityId: string,
  expectedVersion: number,
  updateQuery: string,
  params: unknown[]
): Promise<OptimisticUpdateResult<T>> {
  const result = await ctx.query<T>(updateQuery, params);

  if (result.rowCount === 0) {
    // Version mismatch - fetch current version for error message
    const currentResult = await ctx.query(
      `SELECT version FROM ${entityType} WHERE id = $1`,
      [entityId]
    );

    const currentVersion = currentResult.rows[0]?.version;

    throw new OptimisticLockError(
      entityType,
      entityId,
      expectedVersion,
      currentVersion
    );
  }

  return {
    success: true,
    data: result.rows[0],
    currentVersion: (result.rows[0] as Record<string, unknown>)?.version as number,
  };
}

// ----------------------------------------------------------------------------
// Row Locking Utilities
// ----------------------------------------------------------------------------

/**
 * Lock mode for SELECT ... FOR UPDATE
 */
export type LockMode =
  | 'UPDATE'           // Exclusive lock, blocks other FOR UPDATE
  | 'NO KEY UPDATE'    // Weaker lock, doesn't block foreign key checks
  | 'SHARE'            // Shared lock, blocks UPDATE but allows other SHARE
  | 'KEY SHARE';       // Weakest, only blocks exclusive locks

/**
 * SELECT ... FOR UPDATE with typed result
 *
 * @example
 * const seat = await selectForUpdate<Seat>(ctx, 'seats', seatId);
 * if (!seat) throw new Error('Seat not found');
 * // seat is now locked until transaction completes
 */
export async function selectForUpdate<T extends QueryResultRow>(
  ctx: TransactionContext,
  table: string,
  id: string,
  lockMode: LockMode = 'UPDATE',
  options: {
    columns?: string;
    noWait?: boolean;
    skipLocked?: boolean;
  } = {}
): Promise<T | null> {
  const { columns = '*', noWait = false, skipLocked = false } = options;

  let query = `SELECT ${columns} FROM ${table} WHERE id = $1 FOR ${lockMode}`;
  if (noWait) query += ' NOWAIT';
  if (skipLocked) query += ' SKIP LOCKED';

  const result = await ctx.query<T>(query, [id]);
  return result.rows[0] || null;
}

// ----------------------------------------------------------------------------
// Health Check
// ----------------------------------------------------------------------------

/**
 * Check database connectivity
 */
export async function healthCheck(): Promise<{
  connected: boolean;
  latencyMs: number;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
}> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      connected: true,
      latencyMs: Date.now() - start,
      poolSize: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  } catch {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      poolSize: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }
}

// ----------------------------------------------------------------------------
// Graceful Shutdown
// ----------------------------------------------------------------------------

/**
 * Close all pool connections (call on app shutdown)
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

export default pool;
