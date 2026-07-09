import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({ value, size = 180 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#0f1419", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) return <div className="qr" style={{ width: size, height: size }} />;
  return (
    <div className="qr">
      <img src={dataUrl} width={size} height={size} alt="Payment QR code" />
    </div>
  );
}
