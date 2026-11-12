#version 300 es
precision highp float;
// Stage 3: D averaged down (at most halving per pass: four bilinear taps around the footprint's
// centre), and on the last pass the plane values: log2 of the luminance and the dark channel.
//#include common
uniform sampler2D uInput;
uniform vec2 uSize;
uniform vec2 uInputSize;
uniform vec2 uInputCapacity;
uniform bool uValues;
out vec4 outColor;

vec4 tap(vec2 pixel) {
  return cornerTexture(uInput, pixel, uInputSize, uInputCapacity);
}

void main() {
  vec2 center = (gl_FragCoord.xy / uSize) * uInputSize;
  vec2 quarter = 0.25 * uInputSize / uSize;
  vec4 sum = tap(center + vec2(-quarter.x, -quarter.y));
  sum += tap(center + vec2(quarter.x, -quarter.y));
  sum += tap(center + vec2(-quarter.x, quarter.y));
  sum += tap(center + vec2(quarter.x, quarter.y));
  vec4 average = sum * 0.25;
  if (uValues) {
    vec3 c = average.rgb;
    outColor = vec4(log2(max(luma(c), 0.0001)), clamp(min(c.r, min(c.g, c.b)), 0.0, 1.0), 0.0, 1.0);
  } else {
    outColor = average;
  }
}
