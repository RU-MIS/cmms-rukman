import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from './config/env';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import roleRoutes from './modules/roles/roles.routes';
import customerRoutes from './modules/customers/customers.routes';
import vendorRoutes from './modules/vendors/vendors.routes';
import categoryRoutes from './modules/products/categories.routes';
import unitRoutes from './modules/products/units.routes';
import warehouseRoutes from './modules/products/warehouses.routes';
import productRoutes from './modules/products/products.routes';
import saleRoutes from './modules/sales/sales.routes';
import saleReturnRoutes from './modules/sales/saleReturns.routes';
import purchaseRoutes from './modules/purchases/purchases.routes';
import purchaseReturnRoutes from './modules/purchases/purchaseReturns.routes';
import salesOrderRoutes from './modules/orders/salesOrders.routes';
import purchaseOrderRoutes from './modules/orders/purchaseOrders.routes';
import paymentRoutes from './modules/payments/payments.routes';
import outstandingRoutes from './modules/payments/outstanding.routes';
import accountRoutes from './modules/accounts/accounts.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import productionRoutes from './modules/production/production.routes';
import reportRoutes from './modules/reports/reports.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import documentRoutes from './modules/documents/documents.routes';
import emailRoutes from './modules/email/email.routes';
import excelRoutes from './modules/excel/excel.routes';
import auditLogRoutes from './modules/audit/audit.routes';
import settingsRoutes from './modules/settings/settings.routes';
import backupRoutes from './modules/backup/backup.routes';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
}

const limiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

app.use('/uploads', express.static(path.join(process.cwd(), env.uploadDir)));

app.get('/health', (_req, res) => res.json({ status: 'ok', app: env.appName }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/sale-returns', saleReturnRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/purchase-returns', purchaseReturnRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/outstanding', outstandingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`${env.appName} API listening on port ${env.port} [${env.nodeEnv}]`);
});

export default app;
