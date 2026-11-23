#version 300 es
precision highp float;
// Stage 2: noise reduction on a square-root encoding of G.
//#include common
uniform sampler2D uInput;
uniform vec2 uSize;
uniform vec2 uInputCapacity;
uniform float uU;
uniform float uLuminance;
uniform float uColor;
out vec4 outColor;

vec3 encoded(vec2 pixel) {
  return sqrt(max(cornerTexture(uInput, pixel, uSize, uInputCapacity).rgb, 0.0));
}

void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec4 center = texelFetch(uInput, ivec2(pixel), 0);
  vec3 p = sqrt(max(center.rgb, 0.0));
  float yp = luma(p);
  vec3 cp = p - yp;
  float sr = 0.004 + 0.06 * uLuminance;
  float lumSum = 0.0;
  float lumWeight = 0.0;
  vec3 chromaSum = vec3(0.0);
  float chromaWeight = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 offset = vec2(float(i), float(j));
      float g = exp(-dot(offset, offset) / 4.5);
      vec3 pl = encoded(pixel + offset * uU);
      float yl = luma(pl);
      float wl = g * exp(-(yl - yp) * (yl - yp) / (2.0 * sr * sr));
      lumSum += wl * yl;
      lumWeight += wl;
      vec3 pc = encoded(pixel + offset * 2.0 * uU);
      float yc = luma(pc);
      float wc = g * exp(-(yc - yp) * (yc - yp) / (2.0 * 0.08 * 0.08));
      chromaSum += wc * (pc - yc);
      chromaWeight += wc;
    }
  }
  float ypOut = uLuminance > 0.0 ? lumSum / lumWeight : yp;
  vec3 cpOut = mix(cp, chromaSum / chromaWeight, uColor);
  vec3 d = max(ypOut + cpOut, 0.0);
  outColor = vec4(d * d, center.a);
}
