# Azure PoC - Backend API

Express.js backend for the Azure proof of concept with KWatch webhook integration.

## Features

- ✅ RESTful API for test data (PoC)
- ✅ KWatch webhook handler with queue system
- ✅ Azure Cosmos DB integration (dual containers)
- ✅ Batch processing for webhook notifications
- ✅ Pagination support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Fill in your Azure Cosmos DB credentials in `.env`:
```env
COSMOS_ENDPOINT=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-primary-key-here
COSMOS_DATABASE=SMLTestDB
COSMOS_CONTAINER=testItems
COSMOS_KWATCH_CONTAINER=KWatchRawData
PORT=3000
```

4. Run locally:
```bash
node server.js
```

## API Endpoints

### PoC Test Endpoints
- `GET /api/health` - Health check
- `GET /api/items?page=1&limit=10` - Get paginated test items
- `POST /api/items` - Create new test item

### KWatch Integration (Step 3 & 4)
- `POST /api/webhook/kwatch` - Receive KWatch webhook notifications
- `GET /api/kwatch?page=1&limit=10` - Get paginated KWatch data

## Testing KWatch Webhook

### Automated Test
```bash
node test-kwatch-webhook.js http://localhost:3000
```

### Manual Test with cURL
```bash
curl -X POST http://localhost:3000/api/webhook/kwatch \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "reddit",
    "query": "Keywords: test",
    "datetime": "11 Dec 24 10:30 UTC",
    "link": "https://www.reddit.com/test",
    "author": "testuser",
    "content": "Test message",
    "sentiment": "neutral"
  }'
```

## Queue System

The KWatch webhook uses an in-memory queue with batch processing:

- **Batch Size:** 10 items
- **Processing Interval:** Every 5 seconds
- **Benefits:** Reduces Cosmos DB RU consumption, handles burst traffic

**Monitor queue status:**
```bash
curl http://localhost:3000/api/kwatch?page=1&limit=1
```

## Frontend Integration

The frontend (`/public/index.html`) supports both views:

- **Default:** PoC test data view
- **Hidden:** Press `Ctrl+K` to toggle KWatch data view

## Deploy to Azure App Service

See `PoC_DeploymentGuide.md` for deployment instructions.
