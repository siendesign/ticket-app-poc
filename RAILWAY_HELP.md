# Connecting to Railway Self-Hosted Kafka

It looks like you deployed a **Kafka Container** (Self-Hosted) instead of Upstash. That's fine!

**Good news**: You do NOT need a username/password for this setup (it uses `PLAINTEXT`).

## 1. Get the Public URL
1.  Go to your Railway Dashboard.
2.  Click on your **Kafka** service.
3.  Go to the **Variables** tab.
4.  Look for the value of **`KAFKA_PUBLIC_URL`** (it might be resolved already, or look for `RAILWAY_TCP_PROXY_DOMAIN` and `PORT`).
    *   *Alternative*: Go to **Settings** -> **Networking** and copy the **Public TCP Address**.
    *   It typically looks like: `roundhouse.proxy.rlwy.net:12345`

## 2. Update .env

Update your local `.env` file to use this public address:

```env
# Based on the Railway TCP Address you found
KAFKA_BROKERS=roundhouse.proxy.rlwy.net:12345

# IMPORTANT: Remove/Comment out these lines (No Auth needed for this container)
# KAFKA_SASL_USERNAME=...
# KAFKA_SASL_PASSWORD=...
# KAFKA_SASL_MECHANISM=...
```

## 3. Restart
Restart `npm run dev` to pick up the change.
