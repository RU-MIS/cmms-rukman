'use client';
import { StockMovementPage } from '@/components/forms/StockMovementPage';

export default function StockInPage() {
  return (
    <StockMovementPage
      title="Stock In"
      description="Record stock received outside of a purchase (e.g. found stock, gifts, corrections)"
      endpoint="/inventory/stock-in"
      txnType="STOCK_IN"
      showRate
    />
  );
}
