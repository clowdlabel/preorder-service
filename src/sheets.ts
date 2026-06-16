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

function getWeeklySheetName(date: Date): string {
  // Find Monday of the current week
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((day + 6) % 7));
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(monday.getDate()).padStart(2, "0");
  const year = monday.getFullYear();
  return `Week of ${month}-${dayOfMonth}-${year}`;
}

async function writeToTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string,
  variants: AggregatedVariant[]
): Promise<void> {
  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // Clear existing data (idempotent — safe to re-run)
  await withRetry(`clear:${sheetName}`, () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sheetName}'!A:E`,
    })
  );

  const rows: string[][] = [
    ["Product", "Color", "Size", "Quantity"],
    ...variants.map((v) => [
      v.productTitle,
      v.color,
      v.size,
      String(v.quantity),
    ]),
  ];

  await withRetry(`write:${sheetName}`, () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    })
  );

  console.log(`[sheets] Wrote ${variants.length} rows to "${sheetName}"`);
}

export async function writeWeeklyReport(
  serviceAccountJson: string,
  spreadsheetId: string,
  variants: AggregatedVariant[],
  runDate: Date
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  await writeToTab(sheets, spreadsheetId, getWeeklySheetName(runDate), variants);
}

export async function writeNamedReport(
  serviceAccountJson: string,
  spreadsheetId: string,
  variants: AggregatedVariant[],
  tabName: string
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  await writeToTab(sheets, spreadsheetId, tabName, variants);
}
