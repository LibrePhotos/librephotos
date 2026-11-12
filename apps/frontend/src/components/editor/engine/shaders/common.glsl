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
