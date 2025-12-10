# Azure PoC - Backend API

Express.js backend for the Azure proof of concept.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Fill in your Azure Cosmos DB credentials in `.env`

4. Run locally:
```bash
npm run dev
```

## Endpoints

- `GET /api/health` - Health check
- `GET /api/items?page=1&limit=10` - Get paginated items
- `POST /api/items` - Create new item

## Deploy to Azure App Service

See `PoC_DeploymentGuide.md` for deployment instructions.
