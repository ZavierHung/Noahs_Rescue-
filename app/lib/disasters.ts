export type Disaster = {
  id: string;
  name: string;
  effect: string;
  effectSummary?: string;
  learningEffect?: string;
  learningSummary?: string;
  learningImage?: { file: string; width: number; height: number };
  dimension: "economy" | "environment" | "society";
  dimensionLabel: string;
  band: string;
  triggerValue: number;
  catalogVersion?: string;
  image?: { file: string; width: number; height: number };
};
