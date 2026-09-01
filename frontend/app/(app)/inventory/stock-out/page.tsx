'use client';
import { StockMovementPage } from '@/components/forms/StockMovementPage';

export default function StockOutPage() {
  return (
    <StockMovementPage
      title="Stock Out"
      description="Record stock removed outside of a sale (e.g. damage, samples, internal use)"
      endpoint="/inventory/stock-out"
      txnType="STOCK_OUT"
    />
  );
}
