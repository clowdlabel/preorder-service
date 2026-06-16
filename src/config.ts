export interface Config {
  shopifyStoreDomain: string;
  shopifyClientId: string;
  shopifyClientSecret: string;
  googleSheetId: string;
  googleServiceAccountJson: string;
  lastRunStorage: "file" | "env";
  lastRunAt?: string;
}

export function loadConfig(): Config {
  function required(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  return {
    shopifyStoreDomain: required("SHOPIFY_STORE_DOMAIN"),
    shopifyClientId: required("SHOPIFY_CLIENT_ID"),
    shopifyClientSecret: required("SHOPIFY_CLIENT_SECRET"),
    googleSheetId: required("GOOGLE_SHEET_ID"),
    googleServiceAccountJson: required("GOOGLE_SERVICE_ACCOUNT_JSON"),
    lastRunStorage: (process.env.LAST_RUN_STORAGE ?? "file") as "file" | "env",
    lastRunAt: process.env.LAST_RUN_AT,
  };
}
