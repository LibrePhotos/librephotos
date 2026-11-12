#version 300 es
precision highp float;
// The finished picture on the canvas: the view transform, and the after, before or split view.
uniform sampler2D uAfter;
uniform sampler2D uBefore;
uniform vec2 uAfterCapacity;
uniform vec2 uBeforeCapacity;
uniform vec2 uCanvas;
uniform vec2 uPicture;
uniform vec3 uView;
uniform int uMode;
uniform float uSplit;
out vec4 outColor;

void main() {
  vec2 canvas = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 pixel = (canvas - uView.yz) / uView.x;
  vec2 uv = pixel / uPicture;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    outColor = vec4(0.0);
    return;
  }
  // The pictures fill the bottom-left corner of their textures. Past it, develop and finish repeat
  // the edge pixels, so filtering (and the mipmaps) there read what CLAMP_TO_EDGE would.
  vec2 after = pixel / uAfterCapacity;
  vec2 before = pixel / uBeforeCapacity;
  bool showBefore = uMode == 1 || (uMode == 2 && canvas.x < uSplit * uCanvas.x);
  vec4 color = showBefore ? texture(uBefore, before) : texture(uAfter, after);
  outColor = vec4(color.rgb * color.a, color.a);
}
