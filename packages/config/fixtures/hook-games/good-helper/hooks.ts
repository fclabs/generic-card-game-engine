import { clampScore } from "./helper.js";

export function authorize(score: number): number {
  return clampScore(score);
}
