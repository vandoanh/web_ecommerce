export const foodPlaceholder = "/food-placeholder.svg";

export function isFoodPlaceholder(source: string) {
  return source.split("?")[0].split("#")[0].replace(/^.*\//, "/") === foodPlaceholder;
}

export function imageFallback(currentSource: string) {
  return isFoodPlaceholder(currentSource) ? null : foodPlaceholder;
}
