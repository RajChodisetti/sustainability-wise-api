'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import type { ScanMode } from '@/modules/installhub/forms/catalog';

type DetectedBarcode = { rawValue?: string };
type BrowserBarcodeDetector = {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BrowserBarcodeDetector;

function detectorConstructor(): BarcodeDetectorConstructor | null {
  return (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector ?? null;
}

export function ScannerInput({
  inputId,
  value,
  onChange,
  onScanResult,
  autoOpenKey,
  modes,
  disabled,
}: {
  inputId?: string;
  value: string;
  onChange: (value: string) => void;
  onScanResult?: (value: string) => void;
  autoOpenKey?: number;
  modes: readonly ScanMode[];
  disabled?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastAutoOpenKeyRef = useRef<number | undefined>(undefined);
  const includesBarcode = modes.includes('barcode');
  const includesQr = modes.includes('qr');
  const scanLabel =
    includesBarcode && includesQr
      ? 'Scan barcode / QR'
      : includesQr
        ? 'Scan QR code'
        : 'Scan barcode';

  useEffect(() => {
    if (autoOpenKey === undefined || disabled || lastAutoOpenKeyRef.current === autoOpenKey) return;
    lastAutoOpenKeyRef.current = autoOpenKey;
    setError(null);
    setScanning(true);
  }, [autoOpenKey, disabled]);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let frame = 0;

    async function start() {
      const Detector = detectorConstructor();
      if (!Detector) {
        setError('Live scanning is not supported by this browser. Enter the value manually.');
        setScanning(false);
        return;
      }
      try {
        const acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquiredStream;
        video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        const formats = modes.flatMap((mode) =>
          mode === 'qr'
            ? ['qr_code']
            : ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
        );
        const detector = new Detector({ formats: [...new Set(formats)] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const result = results.find((item) => item.rawValue);
            if (result?.rawValue) {
              onChange(result.rawValue);
              onScanResult?.(result.rawValue);
              setScanning(false);
              return;
            }
          } catch {
            // Camera frames may be unreadable while focus settles.
          }
          frame = requestAnimationFrame(() => void scan());
        };
        void scan();
      } catch (cause) {
        if (stopped) return;
        setError(
          cause instanceof Error && cause.name === 'NotAllowedError'
            ? 'Camera access was denied. Enter the value manually or allow camera access.'
            : 'The camera could not be started. Enter the value manually.',
        );
        setScanning(false);
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [modes, onChange, onScanResult, scanning]);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
        {!disabled ? (
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              setError(null);
              setScanning(true);
            }}
          >
            <Icon name="camera" size={17} />
            {scanLabel}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs leading-5 text-[var(--amber)]" role="status">{error}</p> : null}
      {scanning ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label="Scan code">
          <div className="w-full max-w-lg rounded-[var(--radius-md)] border border-white/15 bg-slate-950 p-4 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-extrabold">Point the camera at the code</p>
                <p className="mt-1 text-xs text-slate-300">The value is filled as soon as it is recognized.</p>
              </div>
              <Button variant="secondary" onClick={() => setScanning(false)}>Cancel</Button>
            </div>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
              <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-cyan-300 shadow-[0_0_0_999px_rgba(0,0,0,.25)]" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
