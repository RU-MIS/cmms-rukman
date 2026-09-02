import toast from 'react-hot-toast';
import { api, apiErrorMessage } from './api';

/** Fetches a PDF/Excel file through the authenticated API client and opens/downloads it, since a plain <a href> would miss the auth header. */
export async function openFile(path: string, filename?: string) {
  try {
    const res = await api.get(path, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(res.data);
    if (filename) {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      window.open(blobUrl, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  } catch (err) {
    toast.error(apiErrorMessage(err));
  }
}
