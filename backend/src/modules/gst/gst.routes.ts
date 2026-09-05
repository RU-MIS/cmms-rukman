import { Router } from 'express';
import { body } from 'express-validator';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { gstinValidator } from '../../utils/gstin';
import { isGstLookupConfigured, lookupGstin } from './gst.service';

const router = Router();
router.use(requireAuth);

/** Lets the frontend show "GST API not configured yet" without leaking any credentials. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, { configured: isGstLookupConfigured() });
  })
);

router.post(
  '/lookup',
  [body('gstin').notEmpty().withMessage('GSTIN is required'), gstinValidator],
  validate,
  asyncHandler(async (req, res) => {
    const result = await lookupGstin(req.body.gstin);
    ok(res, result);
  })
);

export default router;
