# Debugging Railway 500 Error

The error "An error occurred in the Server Components render" typically means your **Database connection failed** or **Tables are missing**.

## 1. Check the Real Error
1.  Go to **Railway Dashboard** -> Click your **Next.js Service**.
2.  Click **Logs**.
3.  Refresh your app.
4.  Look for the **RED** error in the logs.

## 2. Common Causes

### A. Missing Tables (Most Likely)
If you see **`Relation "Event" does not exist`**:
*   **Cause**: You connected to a new Production Database but didn't run migrations.
*   **Fix**:
    1.  Go to **Settings** -> **Build Command**.
    2.  Change it to: `npx prisma migrate deploy && next build`
    3.  **Redeploy**.

### B. Bad Database URL
If you see **`Connection refused`**:
*   **Cause**: `DATABASE_URL` might still be `localhost`.
*   **Fix**: Ensure `DATABASE_URL` in Railway Variables uses the **Railway Postgres Connection String** (e.g., `postgresql://postgres:password@roundhouse.proxy.rlwy.net:...`).

### C. Missing Environment Variables
Ensure these are set in Railway Variables:
*   `DATABASE_URL`
*   `KAFKA_BROKERS`
*   `NEXT_PUBLIC_APP_URL` (e.g. `https://your-app.up.railway.app`)
