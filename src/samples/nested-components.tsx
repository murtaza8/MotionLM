/**
 * Nested components composition — an inline child component uses
 * useCurrentFrame() with arithmetic offset (`frame - 30`), placed inside
 * a parent Sequence. Tests frame offset arithmetic and component-level
 * temporal resolution in the parser.
 */

export const NESTED_COMPONENTS_DURATION = 180; // 6 seconds at 30 fps

export const NESTED_COMPONENTS_SOURCE = `
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';

const Badge = ({ label, offsetFrame }: { label: string; offsetFrame: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // localFrame is zero-based relative to when this component first appears
  const localFrame = frame - offsetFrame;

  const progress = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 200, mass: 0.8 },
  });

  const opacity = interpolate(localFrame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateX = interpolate(progress, [0, 1], [-40, 0]);

  return (
    <div
      style={{
        opacity,
        transform: \`translateX(\${translateX}px)\`,
        padding: '12px 28px',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 20,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 500,
        marginBottom: 12,
      }}
    >
      {label}
    </div>
  );
};

export const NestedComponents = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#08080a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      <Sequence from={0} durationInFrames={180}>
        <Badge label="Alpha" offsetFrame={0} />
      </Sequence>
      <Sequence from={30} durationInFrames={150}>
        <Badge label="Beta" offsetFrame={30} />
      </Sequence>
      <Sequence from={60} durationInFrames={120}>
        <Badge label="Gamma" offsetFrame={60} />
      </Sequence>
    </AbsoluteFill>
  );
};
`.trim();
