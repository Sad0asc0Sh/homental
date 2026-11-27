export const MAX_QUANTITY_CM = 2_147_483_647;

/** Partner prices and labor rates are frozen per meter. Bill to the Toman. */
export function meteredLineAmount(quantityCm: number, unitPrice: bigint): bigint {
  return BigInt(quantityCm) * unitPrice / 100n;
}

/** Seller stock is tracked in whole meters, including the final cut meter. */
export function meteredStockQty(quantityCm: number): number {
  return Math.ceil(quantityCm / 100);
}
