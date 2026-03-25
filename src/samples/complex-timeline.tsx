/**
 * Complex timeline composition — overlapping Sequences, conditional rendering
 * based on frame value, and multiple animations on a single element. Tests the
 * parser's ability to handle dynamic/non-static expressions and overlapping
 * temporal regions.
 */

export const COMPLEX_TIMELINE_DURATION = 300; // 10 seconds at 30 fps

export const COMPLEX_TIMELINE_SOURCE = `
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Easing,
} from 'remotion';

const Chip = ({ text, delay }: { text: string; delay: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 180, mass: 1 },
  });

  const opacity = interpolate(frame - delay, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = interpolate(enter, [0, 1], [0.7, 1]);

  return (
    <span
      style={{
        opacity,
        transform: \`scale(\${scale})\`,
        display: 'inline-block',
        margin: '0 6px',
        padding: '6px 16px',
        borderRadius: 8,
        backgroundColor: 'rgba(59,130,246,0.14)',
        border: '1px solid rgba(59,130,246,0.35)',
        color: 'rgba(255,255,255,0.9)',
        fontSize: 16,
        fontFamily: 'monospace',
      }}
    >
      {text}
    </span>
  );
};

const Headline = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 20, 220, 250], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateY = interpolate(frame, [0, 20], [32, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <h1
      style={{
        opacity,
        transform: \`translateY(\${translateY}px)\`,
        color: 'rgba(255,255,255,0.95)',
        fontSize: 64,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
        letterSpacing: '-0.03em',
        marginBottom: 24,
      }}
    >
      MotionLM
    </h1>
  );
};

export const ComplexTimeline = () => {
  const frame = useCurrentFrame();

  // Conditional: only show the footer chip row after frame 150
  const showFooter = frame >= 150;

  const footerOpacity = interpolate(frame, [150, 170], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#08080a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Headline visible frames 0-250, overlaps with chip sequences */}
      <Sequence from={0} durationInFrames={250}>
        <Headline />
      </Sequence>

      {/* Chips stagger in from frame 60, overlapping with Headline */}
      <Sequence from={60} durationInFrames={240}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          <Chip text="AST" delay={0} />
          <Chip text="Remotion" delay={8} />
          <Chip text="Babel" delay={16} />
        </div>
      </Sequence>

      {/* Footer conditionally rendered based on frame */}
      {showFooter && (
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            opacity: footerOpacity,
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Temporal Awareness
        </div>
      )}
    </AbsoluteFill>
  );
};
`.trim();
