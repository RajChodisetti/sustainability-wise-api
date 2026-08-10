import type { ReactNode } from 'react';
import {
  electricalMapSymbolDefinition,
  type ElectricalMapSymbolName,
  type ElectricalMapSymbolPrimitive,
} from '@/modules/installhub/lib/electricalMapSymbols';
import {
  electricalMapBoardChannelLayout,
  type ElectricalMapBoardChannel,
} from '@/modules/installhub/lib/electricalMapBoardChannels';

export type ElectricalMapSymbolChannel = ElectricalMapBoardChannel;

const SYMBOL_VIEW_BOX = '0 0 64 64';
const SYMBOL_STROKE_WIDTH = 2.4;

function primitiveElement(
  primitive: ElectricalMapSymbolPrimitive,
  accent: string,
  key: string,
): ReactNode {
  const filled = 'fill' in primitive && primitive.fill;
  const presentation = {
    fill: filled ? accent : 'none',
    fillOpacity: filled ? 0.14 : undefined,
    stroke: accent,
    strokeDasharray: primitive.dashed ? '4 3' : undefined,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: SYMBOL_STROKE_WIDTH,
  };
  if (primitive.kind === 'path') {
    return <path key={key} d={primitive.d} {...presentation} />;
  }
  if (primitive.kind === 'rect') {
    return <rect key={key} x={primitive.x} y={primitive.y} width={primitive.width} height={primitive.height} rx={primitive.rx} {...presentation} />;
  }
  if (primitive.kind === 'circle') {
    return <circle key={key} cx={primitive.cx} cy={primitive.cy} r={primitive.r} {...presentation} />;
  }
  if (primitive.kind === 'line') {
    return <line key={key} x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} {...presentation} />;
  }
  return <polyline key={key} points={primitive.points} {...presentation} />;
}

function boardChannelMarkup(
  channels: readonly ElectricalMapSymbolChannel[],
  accent: string,
): ReactNode {
  const channelLayout = electricalMapBoardChannelLayout(channels);
  const twoColumns = channelLayout.some((item) => item.portSide === 'left');

  return (
    <g data-board-channel-count={channels.length} data-board-channel-layout={twoColumns ? 'two-column' : 'single-column'}>
      {channelLayout.map((item) => {
        const { channel, cellHeight, columnWidth, label, portSide, portX, portY, state, x, y } = item;
        const phaseLabel = channel.phaseLabel?.trim().slice(0, 5) || '';
        return (
          <g
            key={channel.id}
            data-channel-id={channel.id}
            data-channel-ordinal={channel.ordinal}
            data-channel-phase={phaseLabel || undefined}
            data-channel-purpose={channel.purpose || undefined}
            data-channel-state={state}
            data-channel-port-side={portSide}
            data-meter-label={channel.meterLabel || undefined}
          >
            <rect
              x={x}
              y={y}
              width={columnWidth}
              height={cellHeight}
              rx="1.2"
              fill={state === 'assigned' ? accent : '#FFFFFF'}
              fillOpacity={state === 'assigned' ? 0.17 : 0.92}
              stroke={accent}
              strokeDasharray={state === 'spare' ? '2 1.5' : undefined}
              strokeWidth="0.9"
            />
            <text
              x={x + 2}
              y={y + cellHeight / 2 + 1.15}
              fill={accent}
              fontFamily="Arial, Helvetica, sans-serif"
              fontSize={twoColumns ? 2.45 : 3.05}
              fontWeight="800"
              letterSpacing="0.08"
            >
              {label}
            </text>
            <circle
              data-channel-port="true"
              data-channel-id={channel.id}
              cx={portX}
              cy={portY}
              r="1.65"
              fill={state === 'spare' ? '#FFFFFF' : accent}
              stroke={accent}
              strokeWidth="0.9"
            />
          </g>
        );
      })}
      {channels.length > channelLayout.length ? (
        <text
          x="32"
          y="54"
          fill={accent}
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="3"
          fontWeight="800"
          textAnchor="middle"
        >
          +{channels.length - channelLayout.length} channels
        </text>
      ) : null}
    </g>
  );
}

function defaultBoardPhaseMarkup(accent: string): ReactNode {
  return (
    <g data-board-phase-fallback="true">
      {(['L1', 'L2', 'L3'] as const).map((phase, index) => {
        const y = 27 + index * 10;
        return (
          <g key={phase} data-phase-rail={phase}>
            <text x="14" y={y + 1.7} fill={accent} fontFamily="Arial, Helvetica, sans-serif" fontSize="4.4" fontWeight="900">{phase}</text>
            <line x1="23" y1={y} x2="50" y2={y} stroke={accent} strokeWidth="1.4" />
            <rect x="31" y={y - 3} width="8" height="6" rx="1.2" fill="#DBEAFE" stroke={accent} strokeWidth="0.9" />
            <circle data-channel-port="true" data-channel-phase={phase} cx="51" cy={y} r="1.6" fill={accent} />
          </g>
        );
      })}
    </g>
  );
}

export function ElectricalMapSymbol({
  name,
  size,
  className,
  channels,
}: {
  name: ElectricalMapSymbolName;
  size: number;
  className?: string;
  /** Canonical switchboard rows shared with channel-specific map connectors. */
  channels?: readonly ElectricalMapSymbolChannel[];
}) {
  const definition = electricalMapSymbolDefinition(name);
  const boardChannels = definition.category === 'board' && channels?.length
    ? channels
    : undefined;
  return (
    <svg
      aria-hidden="true"
      className={`select-none ${className ?? ''}`}
      data-electrical-map-symbol={name}
      data-symbol-category={definition.category}
      data-symbol-style="schematic"
      focusable="false"
      height={size}
      viewBox={SYMBOL_VIEW_BOX}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="3" width="58" height="58" rx="15" fill={definition.tint} />
      {definition.category === 'board' ? (
        <>
          <rect x="9" y="7" width="46" height="50" rx="4" fill="#FFFFFF" fillOpacity="0.94" stroke={definition.accent} strokeWidth={SYMBOL_STROKE_WIDTH} />
          <path d="M9 18h46" fill="none" stroke={definition.accent} strokeWidth="1.4" />
          <circle cx="49" cy="12.5" r="1.7" fill={definition.accent} opacity="0.88" />
          <text x="14" y="14.8" fill={definition.accent} fontFamily="Arial, Helvetica, sans-serif" fontSize="5.2" fontWeight="900" letterSpacing="0.18">
            {definition.boardCode}
          </text>
          {boardChannels
            ? boardChannelMarkup(boardChannels, definition.accent)
            : defaultBoardPhaseMarkup(definition.accent)}
        </>
      ) : definition.primitives.map((primitive, index) => primitiveElement(primitive, definition.accent, `${name}-${index}`))}
    </svg>
  );
}
