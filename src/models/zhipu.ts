export type ZhipuModel =
  | "glm-5.3"
  | "glm-5.2"
  | "glm-5.1"
  | "glm-5"
  | "glm-5-code";
export function isZhipuModel(model: string): model is ZhipuModel {
  return ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-5-code"].includes(
    model,
  );
}
