export function productGalleryImages(imageUrl: string, images: string[] = []) {
  return Array.from(new Set([imageUrl, ...images].filter(Boolean)));
}

export function nextGalleryIndex(index: number, direction: -1 | 1, imageCount: number) {
  return imageCount === 0 ? 0 : (index + direction + imageCount) % imageCount;
}

export function touchSwipeDirection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): -1 | 0 | 1 {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) ? (deltaX < 0 ? 1 : -1) : 0;
}
