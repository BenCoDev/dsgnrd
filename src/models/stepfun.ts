export type StepfunModel = "step-3.5-flash";
export function isStepfunModel(model: string): model is StepfunModel {
  return ["step-3.5-flash"].includes(model);
}
