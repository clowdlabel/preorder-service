import type {
  AggregatedVariant,
  OrdersQueryResponse,
  ShopifyLineItem,
  ShopifyOrder,
} from "./types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cachedAccessToken: string | null = null;

export async function getAccessToken(
  storeDomain: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  console.log("[shopify] Exchanging client credentials for access token...");

  const url = `https://${storeDomain}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Shopify token exchange failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { access_token: string };
  cachedAccessToken = data.access_token;
  console.log("[shopify] Access token obtained successfully");
  return cachedAccessToken;
}

async function shopifyGraphQL(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<OrdersQueryResponse> {
  const url = `https://${storeDomain}/admin/api/2024-10/graphql.json`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429 || response.status >= 500) {
      const retryAfter =
        Number(response.headers.get("Retry-After")) || RETRY_DELAY_MS / 1000;
      console.warn(
        `[shopify] ${response.status} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${retryAfter}s...`
      );
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Shopify API error ${response.status}: ${body}`
      );
    }

    const json = (await response.json()) as OrdersQueryResponse;
    if (json.errors?.length) {
      throw new Error(
        `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
      );
    }
    return json;
  }

  throw new Error("Shopify API: max retries exceeded");
}

const ORDERS_QUERY = `
query FetchOrders($queryFilter: String!, $cursor: String) {
  orders(first: 250, query: $queryFilter, after: $cursor) {
    edges {
      cursor
      node {
        id
        createdAt
        lineItems(first: 250) {
          edges {
            cursor
            node {
              quantity
              variant {
                id
                title
                sku
                product {
                  id
                  title
                  tags
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
    pageInfo { hasNextPage }
  }
}
`;

const LINE_ITEMS_QUERY = `
query FetchLineItems($orderId: ID!, $cursor: String) {
  node(id: $orderId) {
    ... on Order {
      lineItems(first: 250, after: $cursor) {
        edges {
          cursor
          node {
            quantity
            variant {
              id
              title
              sku
              product {
                id
                title
                tags
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}
`;

const PRE_ORDER_PATTERN = /pre[- ]?order/i;

function isPreOrderItem(item: ShopifyLineItem): boolean {
  if (!item.variant?.product) return false;
  return PRE_ORDER_PATTERN.test(item.variant.product.title);
}

async function fetchAllLineItems(
  storeDomain: string,
  accessToken: string,
  order: ShopifyOrder
): Promise<ShopifyLineItem[]> {
  const items: ShopifyLineItem[] = order.lineItems.edges.map((e) => e.node);

  if (!order.lineItems.pageInfo.hasNextPage) {
    return items;
  }

  let cursor =
    order.lineItems.edges[order.lineItems.edges.length - 1]?.cursor ?? null;

  while (cursor) {
    const result = await shopifyGraphQL(
      storeDomain,
      accessToken,
      LINE_ITEMS_QUERY,
      { orderId: order.id, cursor }
    );

    const node = (result.data as any).node;
    if (!node?.lineItems) break;

    for (const edge of node.lineItems.edges) {
      items.push(edge.node);
      cursor = edge.cursor;
    }

    if (!node.lineItems.pageInfo.hasNextPage) break;
  }

  return items;
}

export async function fetchPreOrderLineItems(
  storeDomain: string,
  accessToken: string,
  sinceTimestamp: string
): Promise<{
  items: Array<ShopifyLineItem & { orderCreatedAt: string }>;
  ordersProcessed: number;
}> {
  const queryFilter = `created_at:>'${sinceTimestamp}'`;
  const allItems: Array<ShopifyLineItem & { orderCreatedAt: string }> = [];
  let ordersProcessed = 0;
  let orderCursor: string | null = null;

  console.log(`[shopify] Fetching orders created after ${sinceTimestamp}`);

  do {
    const result = await shopifyGraphQL(storeDomain, accessToken, ORDERS_QUERY, {
      queryFilter,
      cursor: orderCursor,
    });

    const ordersConnection = result.data.orders;

    for (const orderEdge of ordersConnection.edges) {
      const order = orderEdge.node;
      ordersProcessed++;

      const lineItems = await fetchAllLineItems(
        storeDomain,
        accessToken,
        order
      );

      for (const item of lineItems) {
        if (isPreOrderItem(item)) {
          allItems.push({ ...item, orderCreatedAt: order.createdAt });
        }
      }

      orderCursor = orderEdge.cursor;
    }

    if (!ordersConnection.pageInfo.hasNextPage) break;
  } while (true);

  console.log(
    `[shopify] Processed ${ordersProcessed} orders, found ${allItems.length} pre-order line items`
  );

  return { items: allItems, ordersProcessed };
}

export function aggregateByVariant(
  items: ShopifyLineItem[]
): AggregatedVariant[] {
  const map = new Map<string, AggregatedVariant>();

  for (const item of items) {
    if (!item.variant?.product) continue;

    const key = `${item.variant.product.id}:${item.variant.id}`;
    const existing = map.get(key);

    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(key, {
        productId: item.variant.product.id,
        productTitle: item.variant.product.title,
        variantId: item.variant.id,
        variantTitle: item.variant.title,
        sku: item.variant.sku,
        quantity: item.quantity,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle) ||
    a.variantTitle.localeCompare(b.variantTitle)
  );
}
