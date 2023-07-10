export default function(containerWidth) {
  if (containerWidth <= 640) return 300
  if (containerWidth <= 1920) return 400
  return 700
}