interface VoiceIndicatorProps {
  active: boolean;
}

export const VoiceIndicator = ({ active }: VoiceIndicatorProps) => {
  if (!active) return null;
  return (
    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
  );
};
