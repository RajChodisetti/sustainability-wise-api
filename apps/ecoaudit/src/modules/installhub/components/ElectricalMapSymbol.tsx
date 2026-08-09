import Image from 'next/image';
import {
  electricalMapSymbolPath,
  electricalMapSymbolScale,
  type ElectricalMapSymbolName,
} from '@/modules/installhub/lib/electricalMapSymbols';

export function ElectricalMapSymbol({
  name,
  size,
  className,
}: {
  name: ElectricalMapSymbolName;
  size: number;
  className?: string;
}) {
  const presentationScale = electricalMapSymbolScale(name);
  return (
    <Image
      unoptimized
      aria-hidden="true"
      alt=""
      data-electrical-map-symbol={name}
      data-symbol-scale={presentationScale}
      draggable={false}
      src={electricalMapSymbolPath(name)}
      width={size}
      height={size}
      className={`select-none object-contain ${className ?? ''}`}
      style={{ transform: `scale(${presentationScale})`, transformOrigin: 'center' }}
    />
  );
}
