# Shopify Pre-Order Reporting Automation

Automated weekly workflow that reports all products tagged `pre-order` purchased during the reporting period into a Google Sheet.

Runs every Monday at 8:00 AM Eastern. Only processes orders created since the previous successful run.

## What It Does

1. Queries the Shopify Admin GraphQL API for recent orders
2. Filters line items to products tagged `pre-order`
3. Aggregates quantities by product variant
4. Writes results to two Google Sheet tabs:
   - **Current Preorders** — cleared and rewritten each run
   - **History** — appended each run (never deleted)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Shopify API Access

Create a [Custom App](https://admin.shopify.com/store/YOUR_STORE/settings/apps/development) in your Shopify admin.

Required scopes:
- `read_orders`
- `read_products`

Copy the **Admin API access token** (`shpat_...`).

### 3. Google Cloud Configuration

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Sheets API**
3. Create a **Service Account** (IAM & Admin → Service Accounts)
4. Create a JSON key for the service account and download it
5. Create a Google Spreadsheet (or use an existing one)
6. Share the spreadsheet with the service account email (`...@...iam.gserviceaccount.com`) — give **Editor** access
7. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### 4. Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | e.g. `my-store.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify admin API token |
| `GOOGLE_SHEET_ID` | Spreadsheet ID from URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON key contents (single line) |
| `LAST_RUN_STORAGE` | `file` (default) or `env` |

### 5. Run Locally

```bash
npm run build && npm start
# or
npm run dev
```

## Deployment

### GitHub Actions (Recommended)

The workflow at `.github/workflows/weekly-report.yml` runs every Monday at 12:00 UTC (8 AM ET).

Add the four secrets to your repo under **Settings → Secrets and variables → Actions**:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

The `last-run.json` timestamp is persisted via GitHub Actions cache.

You can trigger a manual run from the Actions tab using "Run workflow".

### Vercel Cron

1. Deploy as a Vercel project
2. Create `api/cron.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  const { main } = await import("../dist/index.js");
  await main();
  res.status(200).json({ ok: true });
}
```

3. Add to `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron", "schedule": "0 12 * * 1" }]
}
```

4. Set `LAST_RUN_STORAGE=env` and manage `LAST_RUN_AT` via Vercel KV or an external store.

### AWS EventBridge + Lambda

1. Package as a Lambda (Node.js 20 runtime)
2. Create an EventBridge rule with schedule expression: `cron(0 12 ? * MON *)`
3. Set environment variables in the Lambda configuration
4. Set `LAST_RUN_STORAGE=env` and store `LAST_RUN_AT` in SSM Parameter Store or DynamoDB

## Idempotency

The workflow is idempotent:
- It only processes orders created after the last successful run
- `lastRunAt` is only updated on success
- Re-running for the same period produces the same aggregation
- The "Current Preorders" tab is fully replaced each run
- The "History" tab is append-only
