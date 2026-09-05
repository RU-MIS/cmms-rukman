import { env } from '../../config/env';
import { ApiError } from '../../utils/response';

/**
 * Central GST lookup abstraction. Provider-agnostic on purpose: whichever
 * paid GST API is eventually subscribed to, only this file changes — no
 * route, form, or frontend code needs to know which provider is behind it.
 *
 * No provider is wired up yet. `lookupGstin` intentionally does not call
 * any external API or fabricate a response shape — the real integration
 * (request format, response mapping, caching, credit tracking) is added
 * once a plan is purchased and the real API's documented contract is
 * available to build against.
 */

export function isGstLookupConfigured(): boolean {
  return Boolean(env.gst.apiKey && env.gst.apiBaseUrl);
}

export interface GstLookupResult {
  gstin: string;
  legalName?: string;
  tradeName?: string;
  registrationStatus?: string;
  registrationDate?: string;
  businessConstitution?: string;
  principalPlaceOfBusiness?: string;
  state?: string;
  natureOfBusiness?: string;
}

export async function lookupGstin(_gstin: string): Promise<GstLookupResult> {
  if (!isGstLookupConfigured()) {
    throw new ApiError(503, 'GST API is not configured yet. Add GST_API_KEY and GST_API_BASE_URL on the server to enable this feature.');
  }
  // A provider is configured but the actual integration has not been built —
  // fail loudly rather than guess at a request/response shape sight unseen.
  throw new ApiError(501, 'GST API integration is not implemented yet.');
}
