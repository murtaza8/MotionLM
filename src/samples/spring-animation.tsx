/**
 * Spring animation composition — combines spring() for entrance motion with
 * interpolate() for opacity and color. Tests both spring and interpolate
 * descriptor extraction in the temporal parser.
 */

export const SPRING_ANIMATION_DURATION = 120; // 4 seconds at 30 fps

export const SPRING_ANIMATION_SOURCE = `
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';

export const SpringAnimation = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    config: {
      damping: 14,
      stiffness: 120,
      mass: 1,
    },
  });

  const translateY = interpolate(progress, [0, 1], [80, 0]);

  const opacity = interpolate(frame, [0, 20, 100, 120], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = interpolate(progress, [0, 1], [0.8, 1]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#08080a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          opacity,
          transform: \`translateY(\${translateY}px) scale(\${scale})\`,
          width: 320,
          height: 180,
          borderRadius: 20,
          backgroundColor: 'rgba(59,130,246,0.18)',
          border: '1.5px solid rgba(59,130,246,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 32,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        Spring
      </div>
    </AbsoluteFill>
  );
};
`.trim();
