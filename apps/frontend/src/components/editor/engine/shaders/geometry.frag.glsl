#version 300 es
precision highp float;
// Stage 1: the output pixel reads the source through the output-to-source map. The source texture
// is linear already (an sRGB texture decodes before it filters; linear16 is uploaded linear).
uniform sampler2D uSource;
uniform mat3 uTransform;
uniform vec2 uSize;
uniform bool uMarkOutside;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 st = (uTransform * vec3(uv, 1.0)).xy;
  vec3 color = texture(uSource, st).rgb;
  bool inside = all(greaterThanEqual(st, vec2(0.0))) && all(lessThanEqual(st, vec2(1.0)));
  outColor = vec4(color, uMarkOutside && !inside ? 0.0 : 1.0);
}
