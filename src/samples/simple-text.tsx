/**
 * Simple text composition — stored as a source string so it can be fed
 * directly into the Babel JIT compiler pipeline, not imported as a module.
 */

export const SIMPLE_TEXT_DURATION = 150; // 5 seconds at 30 fps

export const SIMPLE_TEXT_SOURCE = `
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export const SimpleText = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 30, 120, 150], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateY = interpolate(frame, [0, 30], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#08080a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <h1
        style={{
          color: 'rgba(255, 255, 255, 0.92)',
          fontSize: 72,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          opacity,
          transform: \`translateY(\${translateY}px)\`,
        }}
      >
        Hello, MotionLM
      </h1>
    </AbsoluteFill>
  );
};
`.trim();
