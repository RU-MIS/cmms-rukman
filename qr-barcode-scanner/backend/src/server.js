import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import scanRoutes from './routes/scan.js';

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', scanRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`QR/Barcode scanner backend running on port ${port}`);
});
