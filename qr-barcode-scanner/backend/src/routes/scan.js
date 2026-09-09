import { Router } from 'express';
import { appendScanRow } from '../services/googleSheets.js';

const router = Router();

router.post('/scan', async (req, res) => {
  const { value } = req.body || {};

  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'Missing scanned value' });
  }

  try {
    await appendScanRow(value.trim());
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to append scan to Google Sheets:', err.message);
    res.status(500).json({ error: 'Failed to save scan' });
  }
});

export default router;
