import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// After a successful/failed save, wait this long before accepting the next
// scan, so the same code held in front of the camera isn't submitted twice.
const RESUME_DELAY_MS = 1500;
// Also ignore an identical value scanned again within this window, in case
// the camera is still pointed at the same code when scanning resumes.
const DUPLICATE_WINDOW_MS = 3000;

export default function App() {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ value: null, time: 0 });

  const [status, setStatus] = useState({ type: 'idle', message: 'Starting camera…' });
  const [lastValue, setLastValue] = useState('');

  const submitScan = useCallback(async (value) => {
    try {
      const res = await fetch(`${API_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error('Request failed');
      setStatus({ type: 'success', message: 'Saved successfully' });
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to save — try again' });
    } finally {
      setTimeout(() => {
        busyRef.current = false;
        setStatus({ type: 'scanning', message: 'Scanning…' });
      }, RESUME_DELAY_MS);
    }
  }, []);

  const handleResult = useCallback(
    (result) => {
      if (!result || busyRef.current) return;

      const value = result.getText();
      const now = Date.now();
      if (
        lastScanRef.current.value === value &&
        now - lastScanRef.current.time < DUPLICATE_WINDOW_MS
      ) {
        return;
      }

      lastScanRef.current = { value, time: now };
      busyRef.current = true;
      setLastValue(value);
      setStatus({ type: 'saving', message: 'Saving…' });
      submitScan(value);
    },
    [submitScan]
  );

  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
    ]);

    const reader = new BrowserMultiFormatReader(hints);
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result) => {
          if (!cancelled && result) handleResult(result);
        }
      )
      .then((controls) => {
        controlsRef.current = controls;
        if (!cancelled) setStatus({ type: 'scanning', message: 'Scanning…' });
      })
      .catch((err) => {
        console.error('Camera error:', err);
        if (!cancelled) {
          setStatus({ type: 'error', message: 'Camera access denied or unavailable' });
        }
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [handleResult]);

  return (
    <div className="app">
      <h1>Scan QR / Barcode</h1>

      <div className="video-wrap">
        <video ref={videoRef} muted playsInline />
      </div>

      <div className={`status status-${status.type}`}>{status.message}</div>

      {lastValue && (
        <div className="last-value">
          <span className="label">Last scanned</span>
          <span className="value">{lastValue}</span>
        </div>
      )}
    </div>
  );
}
