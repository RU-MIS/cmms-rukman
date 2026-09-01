'use client';
import { StockMovementPage } from '@/components/forms/StockMovementPage';

export default function AdjustmentPage() {
  return (
    <StockMovementPage
      title="Stock Adjustment"
      description="Correct stock counts. Use a positive quantity to increase, negative to decrease (e.g. -5)."
      endpoint="/inventory/adjustment"
      txnType="ADJUSTMENT"
    />
  );
}
