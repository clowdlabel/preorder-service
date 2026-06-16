import { loadConfig } from "./config.js";
import { getLastRunAt, saveLastRunAt } from "./storage.js";
import { getAccessToken, fetchPreOrderLineItems, aggregateByVariant } from "./shopify.js";
import { writeWeeklyReport, writeNamedReport } from "./sheets.js";
import type { RunMetrics } from "./types.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const backfillIndex = args.indexOf("--backfill");
  if (backfillIndex === -1) return null;

  const since = args[backfillIndex + 1];
  const tabName = args[backfillIndex + 2];
  if (!since || !tabName) {
    console.error("Usage: --backfill <since-date> <tab-name>");
    console.error('Example: --backfill 2026-05-01 "Soft Launch"');
    process.exit(1);
  }
  return { since, tabName };
}

function printMetrics(metrics: RunMetrics): void {
  console.log("\n=== Run Metrics ===");
  console.log(`Orders Processed:       ${metrics.ordersProcessed}`);
  console.log(`Matching Line Items:    ${metrics.matchingLineItems}`);
  console.log(`Unique Variants:        ${metrics.uniqueVariants}`);
  console.log(`Total Preorder Quantity: ${metrics.totalPreorderQuantity}`);
  console.log(`Execution Time:         ${metrics.executionTimeMs}ms`);
  console.log("");
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const backfill = parseArgs();
  const config = loadConfig();

  if (backfill) {
    console.log(`\n=== Backfill: "${backfill.tabName}" since ${backfill.since} ===\n`);
  } else {
    console.log(`\n=== Shopify Pre-Order Report — ${new Date().toISOString().split("T")[0]} ===\n`);
  }

  // Determine time range
  const sinceTimestamp = backfill
    ? new Date(backfill.since + "T00:00:00Z").toISOString()
    : getLastRunAt(config) ??
      (() => {
        console.log("[main] No previous run found. Defaulting to 7 days ago.");
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      })();

  console.log(`[main] Fetching orders since: ${sinceTimestamp}`);

  const accessToken = await getAccessToken(
    config.shopifyStoreDomain,
    config.shopifyClientId,
    config.shopifyClientSecret
  );

  const { items, ordersProcessed } = await fetchPreOrderLineItems(
    config.shopifyStoreDomain,
    accessToken,
    sinceTimestamp
  );

  const aggregated = aggregateByVariant(items);

  // Write to Google Sheets
  if (backfill) {
    await writeNamedReport(
      config.googleServiceAccountJson,
      config.googleSheetId,
      aggregated,
      backfill.tabName
    );
  } else {
    await writeWeeklyReport(
      config.googleServiceAccountJson,
      config.googleSheetId,
      aggregated,
      new Date()
    );
    saveLastRunAt(config, new Date().toISOString());
  }

  printMetrics({
    ordersProcessed,
    matchingLineItems: items.length,
    uniqueVariants: aggregated.length,
    totalPreorderQuantity: aggregated.reduce((sum, v) => sum + v.quantity, 0),
    executionTimeMs: Date.now() - startTime,
  });
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
