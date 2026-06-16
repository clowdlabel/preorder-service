import { google } from "googleapis";
import type { AggregatedVariant } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSheetsClient(serviceAccountJson: string) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code;
      const isRetryable =
        status === 429 || status === 503 || status === "ECONNRESET";

      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(
          `[sheets] ${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`
        );
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`[sheets] ${label}: max retries exceeded`);
}

async function ensureSheetExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetTitle: string
): Promise<void> {
  const spreadsheet = await withRetry("getSpreadsheet", () =>
    sheets.spreadsheets.get({ spreadsheetId })
  );

  const exists = spreadsheet.data.sheets?.some(
    (s) => s.properties?.title === sheetTitle
  );

  if (!exists) {
    await withRetry("addSheet", () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { addSheet: { properties: { title: sheetTitle } } },
          ],
        },
      })
    );
    console.log(`[sheets] Created sheet: ${sheetTitle}`);
  }
}

export async function writeCurrentTotals(
  serviceAccountJson: string,
  spreadsheetId: string,
  variants: AggregatedVariant[]
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  const sheetName = "Current Preorders";

  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // Clear existing data
  await withRetry("clearCurrentTotals", () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sheetName}'!A:D`,
    })
  );

  // Write header + data
  const rows: string[][] = [
    ["Product", "Variant", "SKU", "Quantity"],
    ...variants.map((v) => [
      v.productTitle,
      v.variantTitle,
      v.sku,
      String(v.quantity),
    ]),
  ];

  await withRetry("writeCurrentTotals", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    })
  );

  console.log(
    `[sheets] Wrote ${variants.length} rows to "${sheetName}"`
  );
}

export async function appendHistorySnapshot(
  serviceAccountJson: string,
  spreadsheetId: string,
  variants: AggregatedVariant[],
  runDate: string
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  const sheetName = "History";

  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // Check if header row exists
  const existing = await withRetry("readHistoryHeader", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:E1`,
    })
  );

  if (!existing.data.values?.length) {
    await withRetry("writeHistoryHeader", () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [["Run Date", "Product", "Variant", "SKU", "Quantity"]],
        },
      })
    );
  }

  // Append snapshot rows
  const rows = variants.map((v) => [
    runDate,
    v.productTitle,
    v.variantTitle,
    v.sku,
    String(v.quantity),
  ]);

  if (rows.length > 0) {
    await withRetry("appendHistory", () =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A:E`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      })
    );
  }

  console.log(
    `[sheets] Appended ${rows.length} rows to "${sheetName}"`
  );
}
