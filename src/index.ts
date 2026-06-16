import { loadConfig } from "./config.js";
import { getLastRunAt, saveLastRunAt } from "./storage.js";
import { fetchPreOrderLineItems, aggregateByVariant } from "./shopify.js";
import { writeCurrentTotals, appendHistorySnapshot } from "./sheets.js";
import type { RunMetrics } from "./types.js";

async function main(): Promise<void> {
  const startTime = Date.now();
  const runDate = new Date().toISOString().split("T")[0]!;

  console.log(`\n=== Shopify Pre-Order Report — ${runDate} ===\n`);

  const config = loadConfig();

  const lastRunAt = getLastRunAt(config);
  if (!lastRunAt) {
    console.log(
      "[main] No previous run found. Defaulting to 7 days ago."
    );
  }

  const sinceTimestamp =
    lastRunAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`[main] Fetching orders since: ${sinceTimestamp}`);

  // 1. Fetch pre-order line items from Shopify
  const { items, ordersProcessed } = await fetchPreOrderLineItems(
    config.shopifyStoreDomain,
    config.shopifyAccessToken,
    sinceTimestamp
  );

  // 2. Aggregate by variant
  const aggregated = aggregateByVariant(items);

  // 3. Write to Google Sheets
  await writeCurrentTotals(
    config.googleServiceAccountJson,
    config.googleSheetId,
    aggregated
  );

  await appendHistorySnapshot(
    config.googleServiceAccountJson,
    config.googleSheetId,
    aggregated,
    runDate
  );

  // 4. Persist last run timestamp
  const executionEnd = new Date().toISOString();
  saveLastRunAt(config, executionEnd);

  // 5. Print metrics
  const metrics: RunMetrics = {
    ordersProcessed,
    matchingLineItems: items.length,
    uniqueVariants: aggregated.length,
    totalPreorderQuantity: aggregated.reduce((sum, v) => sum + v.quantity, 0),
    executionTimeMs: Date.now() - startTime,
  };

  console.log("\n=== Run Metrics ===");
  console.log(`Orders Processed:       ${metrics.ordersProcessed}`);
  console.log(`Matching Line Items:    ${metrics.matchingLineItems}`);
  console.log(`Unique Variants:        ${metrics.uniqueVariants}`);
  console.log(`Total Preorder Quantity: ${metrics.totalPreorderQuantity}`);
  console.log(`Execution Time:         ${metrics.executionTimeMs}ms`);
  console.log("");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
