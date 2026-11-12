#version 300 es
precision highp float;
// Stage 4: from D (linear) to e (display-encoded), per pixel.
//#include common
//#include oklab
uniform sampler2D uInput;
uniform sampler2D uPlaneCoarse;
uniform sampler2D uPlaneFine;
uniform sampler2D uLightTable;
uniform sampler2D uCurveTable;
uniform sampler2D uHueTable;
uniform vec2 uSize;
uniform vec3 uK;
uniform float uGain;
uniform float uM;
uniform float uDehaze;
uniform float uShadows;
uniform float uHighlights;
uniform float uClarity;
uniform float uTexture;
uniform bool uUseLight;
uniform bool uUseCurve;
uniform bool uUseColor;
uniform bool uBw;
uniform float uVibrance;
uniform float uSaturation;
uniform vec2 uGradeVectors[4];
uniform vec4 uGradeLum;
uniform float uBalance;
uniform float uBlending;
out vec4 outColor;

const float TABLE_LAST = 1023.0;

// Linear lookup of a 1024-entry table at x in 0 to 1 (entry i at x = i / 1023).
vec4 table(sampler2D t, float x) {
  float position = clamp(x, 0.0, 1.0) * TABLE_LAST;
  float i0 = floor(position);
  float i1 = min(i0 + 1.0, TABLE_LAST);
  return mix(texelFetch(t, ivec2(int(i0), 0), 0), texelFetch(t, ivec2(int(i1), 0), 0), position - i0);
}

// Linear lookup of the hue table at h degrees, wrapping at 360.
vec4 hueTable(float h) {
  float position = mod(h, 360.0);
  float i0 = min(floor(position), 359.0);
  float i1 = mod(i0 + 1.0, 360.0);
  vec4 a = texelFetch(uHueTable, ivec2(int(i0), 0), 0);
  vec4 b = texelFetch(uHueTable, ivec2(int(i1), 0), 0);
  return mix(a, b, position - i0);
}

float hueDistance(float a, float b) {
  float d = mod(abs(a - b), 360.0);
  return min(d, 360.0 - d);
}

float rollOff(float c) {
  const float K = 0.8;
  c = clamp(c, 0.0, uM);
  if (uM > 1.0 && c > K) {
    float t = (c - K) / (uM - K);
    float p = (uM - K) / (1.0 - K);
    c = K + (1.0 - K) * (1.0 - pow(1.0 - t, p));
  }
  return clamp(c, 0.0, 1.0);
}

// Small differences kept, large ones limited (4.4).
float soft(float x) {
  return x / (1.0 + 1.5 * abs(x));
}

vec3 colour(vec3 e) {
  vec3 lab = linearToOklab(eotf(e));
  float Lk = lab.x;
  float C = length(lab.yz);
  float h = C > 0.0 ? mod(degrees(atan(lab.z, lab.y)), 360.0) : 0.0;
  vec4 hue = hueTable(h);
  float mc = smoothstep(0.0, 0.05, C);
  float ml = smoothstep(0.0, 0.12, C);
  if (uBw) {
    Lk = Lk * (1.0 + 0.5 * hue.w * ml);
    C = 0.0;
  } else {
    h = h + hue.x * mc;
    C = C * (1.0 + hue.y * mc);
    Lk = Lk * (1.0 + 0.35 * hue.z * ml);
    float skin = exp(-pow(hueDistance(h, 55.0) / 25.0, 2.0));
    C = C * (1.0 + 0.7 * uVibrance * (1.0 - smoothstep(0.0, 0.25, C)) * (1.0 - 0.8 * skin));
    C = C * (1.0 + uSaturation);
  }
  float p = 0.5 - 0.25 * uBalance;
  float dd = 0.05 + 0.25 * uBlending;
  float ws = 1.0 - smoothstep(p - 0.25 - dd, p - 0.25 + dd, Lk);
  float wh = smoothstep(p + 0.25 - dd, p + 0.25 + dd, Lk);
  float wm = max(0.0, 1.0 - ws - wh);
  float protect = clamp(Lk / 0.08, 0.0, 1.0) * clamp((1.0 - Lk) / 0.04, 0.0, 1.0);
  float hr = radians(h);
  vec2 tint = ws * uGradeVectors[0] + wm * uGradeVectors[1] + wh * uGradeVectors[2] + uGradeVectors[3];
  vec2 ab = C * vec2(cos(hr), sin(hr)) + 0.10 * protect * tint;
  Lk = Lk + 0.2 * protect * dot(vec4(ws, wm, wh, 1.0), uGradeLum);
  return oetf(clamp(oklabToLinear(vec3(Lk, ab)), 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 d = texelFetch(uInput, ivec2(gl_FragCoord.xy), 0);
  vec3 rgb = d.rgb;
  float ly = log2(max(luma(rgb), 0.0001));
  vec2 coarse = texture(uPlaneCoarse, uv).rg;
  float lc = coarse.r;
  float dk = coarse.g;
  float lf = texture(uPlaneFine, uv).r;

  // 4.1 Dehaze
  if (uDehaze != 0.0) {
    vec3 x = min(rgb, 1.0);
    vec3 rest = rgb - x;
    if (uDehaze > 0.0) {
      float t = max(1.0 - 0.6 * uDehaze * dk, 0.4);
      x = max(vec3(0.0), 1.0 - (1.0 - x) / t);
    } else {
      float t = 1.0 - 0.6 * abs(uDehaze) * (0.4 + 0.6 * dk);
      x = x * t + (1.0 - t);
    }
    rgb = x + rest;
  }

  // 4.2 White balance and exposure
  rgb = rgb * uK * uGain;

  // 4.3 Highlights and shadows
  if (uShadows != 0.0 || uHighlights != 0.0) {
    float dblur = pow(clamp(exp2(lc) * uGain, 0.0, 1.0), 1.0 / 2.2);
    float dpix = pow(clamp(luma(rgb), 0.0, 1.0), 1.0 / 2.2);
    float dm = clamp(dblur, dpix - 0.05, dpix + 0.05);
    float ws = 1.0 - smoothstep(0.0, 0.5, dm);
    float wh = smoothstep(0.5, 1.0, dm);
    if (uHighlights < 0.0) {
      float brightest = min(max(rgb.r, max(rgb.g, rgb.b)) / uM, 1.0);
      float b2 = brightest * brightest;
      float b4 = b2 * b2;
      wh = wh * (1.0 - b4 * b4);
    }
    rgb = rgb * exp2(1.5 * uShadows * ws + 0.9 * uHighlights * wh);
  }

  // 4.4 Clarity and texture
  if (uClarity != 0.0 || uTexture != 0.0) {
    float dc = soft(ly - lc);
    float dt = soft(ly - lf);
    float dpix = pow(clamp(luma(rgb), 0.0, 1.0), 1.0 / 2.2);
    float m = 1.0 - (2.0 * dpix - 1.0) * (2.0 * dpix - 1.0);
    rgb = rgb * exp2(0.9 * uClarity * dc * m + 1.2 * uTexture * dt * (0.5 + 0.5 * m));
  }

  // 4.5 Highlight roll-off and encoding
  vec3 e = oetf(vec3(rollOff(rgb.r), rollOff(rgb.g), rollOff(rgb.b)));

  // 4.6 Light table
  if (uUseLight) {
    e = vec3(table(uLightTable, e.r).r, table(uLightTable, e.g).r, table(uLightTable, e.b).r);
  }

  // 4.7 Colour
  if (uUseColor) {
    e = colour(e);
  }

  // 4.8 Tone curve table
  if (uUseCurve) {
    e = vec3(table(uCurveTable, e.r).r, table(uCurveTable, e.g).g, table(uCurveTable, e.b).b);
  }

  outColor = vec4(e, d.a);
}
