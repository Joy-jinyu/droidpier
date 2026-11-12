const VS = `#version 300 es
in vec2 a;
out vec2 uv;
void main() {
  // 帧的行序是自上而下，这里统一翻转 v
  uv = vec2((a.x + 1.0) / 2.0, (1.0 - a.y) / 2.0);
  gl_Position = vec4(a, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D t;
out vec4 o;
void main() { o = vec4(texture(t, uv).rgb, 1.0); }`;

/** WebGL2 画面渲染：put 只存最新一帧，绘制只发生在 requestAnimationFrame 里；没有新帧时不调度 rAF。 */
export function createRenderer(canvas: HTMLCanvasElement, onDraw: (tsMs: number) => void): {
  put(pixels: Uint8Array, width: number, height: number, tsMs: number): void;
} {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false })!;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  let tex: WebGLTexture | null = null;
  let texW = 0;
  let texH = 0;
  // 尺寸变化（DPR 变了）时重建纹理，画布像素尺寸跟着帧走
  const ensureTexture = (w: number, h: number) => {
    if (tex && w === texW && h === texH) return;
    if (tex) gl.deleteTexture(tex);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    texW = w;
    texH = h;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  let latest: { pixels: Uint8Array; width: number; height: number; tsMs: number } | null = null;
  let scheduled = false;
  const draw = () => {
    scheduled = false;
    const f = latest;
    if (!f) return;
    latest = null;
    ensureTexture(f.width, f.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.width, f.height, gl.RGBA, gl.UNSIGNED_BYTE, f.pixels);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    onDraw(f.tsMs);
  };

  return {
    put(pixels, width, height, tsMs) {
      latest = { pixels, width, height, tsMs };
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(draw);
      }
    },
  };
}
