export interface ModelConfig {
  id: string;
  label: string;
  supportsVision: boolean;
  supportsTools: boolean;
}

export const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5 (fast)",
    supportsVision: true,
    supportsTools: true,
  },
];

export const getModel = (id: string): ModelConfig => {
  const model = MODEL_REGISTRY.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
};

export const listModels = (): ModelConfig[] => MODEL_REGISTRY;
