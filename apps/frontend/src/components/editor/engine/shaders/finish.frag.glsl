#version 300 es
precision highp float;
precision highp int;
// Stage 5: sharpening, vignette and grain on the display-encoded picture.
//#include common
uniform sampler2D uInput;
uniform vec2 uSize;
uniform vec2 uInputCapacity;
uniform float uSharpen;
uniform float uSigma;
uniform float uVignette;
uniform float uMidpoint;
uniform float uFeather;
uniform float uRoundness;
uniform float uGrain;
uniform float uCells;
uniform float uRoughness;
uniform uint uSeed;
out vec4 outColor;

// The grain hash on unsigned 32-bit integers, wrapping.
float hash(uint ix, uint iy) {
  uint n = (ix * 0x8da6b343u) ^ (iy * 0xd8163841u) ^ (uSeed * 0xcb1ab31fu);
  n = n ^ (n >> 15u);
  n = n * 0x2c1b3c6du;
  n = n ^ (n >> 12u);
  n = n * 0x297a2d39u;
  n = n ^ (n >> 15u);
  return float(n) / 4294967295.0 * 2.0 - 1.0;
}

float valueNoise(vec2 g) {
  vec2 cell = floor(g);
  vec2 f = g - cell;
  uint ix = uint(cell.x);
  uint iy = uint(cell.y);
  float bottom = mix(hash(ix, iy), hash(ix + 1u, iy), f.x);
  float top = mix(hash(ix, iy + 1u), hash(ix + 1u, iy + 1u), f.x);
  return mix(bottom, top, f.y);
}

void main() {
  // The target is drawn past its picture too: those pixels repeat the picture's edge pixel.
  vec2 pixel = min(gl_FragCoord.xy, uSize - 0.5);
  vec2 uv = pixel / uSize;
  vec4 center = texelFetch(uInput, ivec2(pixel), 0);
  vec3 e = center.rgb;

  // 5.1 Sharpening
  if (uSharpen > 0.0) {
    float ye = luma(e);
    float blur = 0.0;
    float total = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 offset = vec2(float(i), float(j));
        float w = exp(-dot(offset, offset) / 2.0);
        blur += w * luma(cornerTexture(uInput, pixel + offset * uSigma, uSize, uInputCapacity).rgb);
        total += w;
      }
    }
    e = clamp(e + 1.2 * uSharpen * (ye - blur / total), 0.0, 1.0);
  }

  // 5.2 Vignette
  if (uVignette != 0.0) {
    vec2 q = 2.0 * uv - 1.0;
    float ar = uSize.x / uSize.y;
    if (uRoundness > 0.0 && ar > 1.0) q.x = q.x * mix(1.0, ar, uRoundness);
    if (uRoundness > 0.0 && ar < 1.0) q.y = q.y * mix(1.0, 1.0 / ar, uRoundness);
    float n = 2.0 - 6.0 * min(uRoundness, 0.0);
    float d = pow(pow(abs(q.x), n) + pow(abs(q.y), n), 1.0 / n);
    float r0 = 0.2 + uMidpoint;
    float r1 = r0 + 0.2 + uFeather;
    float v = smoothstep(r0, r1, d);
    float a = 0.85 * uVignette * v;
    e = uVignette < 0.0 ? e * (1.0 + a) : e + (1.0 - e) * a;
  }

  // 5.3 Grain
  if (uGrain > 0.0) {
    float longEdge = max(uSize.x, uSize.y);
    vec2 g = uv * uCells * uSize / longEdge;
    float rough = (1.0 - 0.5 * uRoughness) * valueNoise(g);
    float n = rough + 0.5 * uRoughness * valueNoise(2.0 * g + vec2(17.0, 31.0));
    float ye = luma(e);
    e = clamp(e + 0.18 * uGrain * n * sqrt(clamp(4.0 * ye * (1.0 - ye), 0.0, 1.0)), 0.0, 1.0);
  }

  outColor = vec4(e, center.a);
}
