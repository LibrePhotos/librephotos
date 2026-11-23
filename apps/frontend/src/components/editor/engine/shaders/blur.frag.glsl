#version 300 es
precision highp float;
// Stage 3: one direction of the separable Gaussian, kernel radius ceil(3 sigma).
//#include common
uniform sampler2D uInput;
uniform vec2 uSize;
uniform vec2 uInputCapacity;
uniform vec2 uDirection;
uniform float uSigma;
out vec4 outColor;

void main() {
  int radius = int(ceil(3.0 * uSigma));
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -radius; i <= radius; i++) {
    float x = float(i);
    float w = exp(-x * x / (2.0 * uSigma * uSigma));
    sum += w * cornerTexture(uInput, gl_FragCoord.xy + uDirection * x, uSize, uInputCapacity);
    total += w;
  }
  outColor = sum / total;
}
