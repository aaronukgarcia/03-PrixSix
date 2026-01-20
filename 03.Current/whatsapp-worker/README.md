# Prix Six WhatsApp Worker

A Dockerized Node.js service that listens to Firestore and sends WhatsApp messages to the Prix Six group chat.

## Architecture

```
Firebase Functions → whatsapp_queue (Firestore) → WhatsApp Worker → WhatsApp Group
```

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy service account
cp ../service-account.json ./service-account.json

# Create .env file
cp .env.example .env

# Run (first time will show QR code)
npm run dev
```

### Docker

```bash
# Build
npm run docker:build

# Run
docker run -it --rm \
  -p 3000:3000 \
  -e FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
  -e FIREBASE_STORAGE_BUCKET='your-project.appspot.com' \
  prixsix-whatsapp-worker
```

## Queue Document Format

Add documents to `whatsapp_queue` collection:

```typescript
{
  groupName: "Prix Six",    // OR chatId: "123456789@c.us"
  message: "🏁 Race results are in!",
  status: "PENDING",
  createdAt: Timestamp.now()
}
```

## Endpoints

- `GET /health` - Health check
- `GET /status` - Detailed status with group list
- `GET /qr` - Get QR code data for authentication

## Initial QR Code Scan

The QR code appears in container logs. Watch logs during first deployment:

```bash
# Railway
railway logs

# Docker
docker logs -f <container_id>
```

Scan within 60 seconds with WhatsApp mobile app.
