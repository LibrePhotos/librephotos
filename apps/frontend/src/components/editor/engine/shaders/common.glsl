// Shared by every pass (apps/docs/docs/development/photo-editing.md, "Notation").
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) {
  return dot(c, LUMA);
}

float oetf1(float x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

vec3 oetf(vec3 c) {
  return vec3(oetf1(c.r), oetf1(c.g), oetf1(c.b));
}

float eotf1(float e) {
  return e <= 0.04045 ? e / 12.92 : pow((e + 0.055) / 1.055, 2.4);
}

vec3 eotf(vec3 e) {
  return vec3(eotf1(e.r), eotf1(e.g), eotf1(e.b));
}

// A bilinear read of a render target at `pixel` (a position in its pixels). Its picture fills the
// bottom-left `size` corner of a texture of `capacity` pixels; clamping to the outer pixel centres
// never filters in what lies past the picture, and reads what CLAMP_TO_EDGE reads on a texture of
// exactly `size`.
vec4 cornerTexture(sampler2D t, vec2 pixel, vec2 size, vec2 capacity) {
  return texture(t, clamp(pixel, vec2(0.5), size - 0.5) / capacity);
}
