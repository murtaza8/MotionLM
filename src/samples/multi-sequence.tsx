/**
 * Multi-sequence composition — three elements in separate <Sequence> blocks
 * with different from/durationInFrames values. Tests absolute frame range
 * resolution in the temporal parser.
 */

export const MULTI_SEQUENCE_DURATION = 270; // 9 seconds at 30 fps

export const MULTI_SEQUENCE_SOURCE = `
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from 'remotion';

export const MultiSequence = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#08080a' }}>
      <Sequence from={0} durationInFrames={90}>
        <TitleCard label="First" color="#3b82f6" />
      </Sequence>
      <Sequence from={90} durationInFrames={90}>
        <TitleCard label="Second" color="#10b981" />
      </Sequence>
      <Sequence from={180} durationInFrames={90}>
        <TitleCard label="Third" color="#f59e0b" />
      </Sequence>
    </AbsoluteFill>
  );
};

const TitleCard = ({ label, color }: { label: string; color: string }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 15, 75, 90], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = interpolate(frame, [0, 15], [0.9, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          opacity,
          transform: \`scale(\${scale})\`,
          padding: '32px 64px',
          borderRadius: 16,
          backgroundColor: color,
          color: '#fff',
          fontSize: 48,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
`.trim();
