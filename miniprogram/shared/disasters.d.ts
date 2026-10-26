export type Disaster = {
  id: string;
  name: string;
  effect: string;
  dimension: 'economy' | 'environment' | 'society';
  dimensionLabel: string;
  band: string;
  triggerValue: number;
  // Optional so old, read-only archives can still display their original text.
  catalogVersion?: string;
  image?: { file: string; width: number; height: number };
};
