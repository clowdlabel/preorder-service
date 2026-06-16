export interface ShopifyLineItem {
  quantity: number;
  variant: {
    id: string;
    title: string;
    sku: string;
    product: {
      id: string;
      title: string;
      tags: string[];
    };
  } | null;
}

export interface ShopifyOrder {
  id: string;
  createdAt: string;
  lineItems: {
    edges: Array<{ node: ShopifyLineItem; cursor: string }>;
    pageInfo: { hasNextPage: boolean };
  };
}

export interface OrdersQueryResponse {
  data: {
    orders: {
      edges: Array<{ node: ShopifyOrder; cursor: string }>;
      pageInfo: { hasNextPage: boolean };
    };
  };
  errors?: Array<{ message: string }>;
}

export interface AggregatedVariant {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  sku: string;
  quantity: number;
}

export interface RunMetrics {
  ordersProcessed: number;
  matchingLineItems: number;
  uniqueVariants: number;
  totalPreorderQuantity: number;
  executionTimeMs: number;
}
