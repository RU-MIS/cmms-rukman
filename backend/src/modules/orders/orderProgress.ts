import { Prisma } from '@prisma/client';

export async function updateSalesOrderProgress(tx: Prisma.TransactionClient, salesOrderId: number) {
  const items = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
  const allDelivered = items.every((i) => Number(i.deliveredQty) >= Number(i.orderedQty));
  const anyDelivered = items.some((i) => Number(i.deliveredQty) > 0);
  const status = allDelivered ? 'COMPLETED' : anyDelivered ? 'PARTIAL' : 'PENDING';
  await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status } });
}

export async function updatePurchaseOrderProgress(tx: Prisma.TransactionClient, purchaseOrderId: number) {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId } });
  const allReceived = items.every((i) => Number(i.receivedQty) >= Number(i.orderedQty));
  const anyReceived = items.some((i) => Number(i.receivedQty) > 0);
  const status = allReceived ? 'COMPLETED' : anyReceived ? 'PARTIAL' : 'PENDING';
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
}
