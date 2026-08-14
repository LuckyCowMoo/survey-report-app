import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent
} from "react";
import { captureJpegFromCanvas } from "../lib/cameraCapture";
import { angleDelta } from "../lib/tutorial/script";
import {
  createLookTracker,
  resetLookTracker,
  trackerPushGyro,
  trackerPushOrientation,
  readPose
} from "../lib/tutorial/orientation";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
varying vec2 vUv;

void main() {
  vec2 ndc = vec2(vUv.x * 2.0 - 1.0, vUv.y * 2.0 - 1.0);
  ndc.x *= uRes.x / max(uRes.y, 1.0);
  float t = tan(uFov * 0.5);
  vec3 dir = normalize(vec3(ndc.x * t, ndc.y * t, -1.0));
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
  gl_FragColor = texture2D(uTex, uv);
}
`;

export type EquirectHandle = {
  getLook: () => { yaw: number; pitch: number };
  setLook: (yaw: number, pitch: number) => void;
  animateTo: (yaw: number, pitch: number, ms: number) => Promise<void>;
  setLocked: (locked: boolean) => void;
  recalibrate: () => void;
  captureJpeg: () => Promise<Uint8Array>;
};

type Props = {
  pano: HTMLImageElement | null;
  fov?: number;
  locked?: boolean;
  className?: string;
  onLook?: (look: { yaw: number; pitch: number }) => void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("WebGL shader failed.");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || "WebGL shader failed.");
  }
  return sh;
}

function clampPitch(p: number) {
  return Math.max(-1.2, Math.min(1.2, p));
}

function getGl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const opts: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "default"
  };
  return (
    canvas.getContext("webgl", opts) ||
    canvas.getContext("experimental-webgl", opts)
  ) as WebGLRenderingContext | null;
}

function viewSize(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  const rect = (parent ?? canvas).getBoundingClientRect();
  const cssW = rect.width || canvas.clientWidth || window.innerWidth || 1;
  const cssH = rect.height || canvas.clientHeight || window.innerHeight || 1;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return {
    cssW,
    cssH,
    w: Math.max(2, Math.floor(cssW * dpr)),
    h: Math.max(2, Math.floor(cssH * dpr))
  };
}

function drawSoftware(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  yaw: number,
  pitch: number,
  fov: number,
  w: number,
  h: number
) {
  const aspect = w / Math.max(1, h);
  const vfov = 2 * Math.atan(Math.tan(fov / 2) / aspect);
  const spanX = (fov / (Math.PI * 2)) * img.naturalWidth;
  const spanY = (vfov / Math.PI) * img.naturalHeight;
  let sx = ((yaw / (Math.PI * 2) + 0.5) % 1) * img.naturalWidth - spanX / 2;
  if (sx < 0) sx += img.naturalWidth;
  const sy = Math.max(
    0,
    Math.min(
      img.naturalHeight - spanY,
      (0.5 - pitch / Math.PI) * img.naturalHeight - spanY / 2
    )
  );
  ctx.fillStyle = "#c9d6e2";
  ctx.fillRect(0, 0, w, h);
  if (sx + spanX <= img.naturalWidth) {
    ctx.drawImage(img, sx, sy, spanX, spanY, 0, 0, w, h);
  } else {
    const first = img.naturalWidth - sx;
    const t = first / spanX;
    ctx.drawImage(img, sx, sy, first, spanY, 0, 0, w * t, h);
    ctx.drawImage(img, 0, sy, spanX - first, spanY, w * t, 0, w * (1 - t), h);
  }
}

const EquirectViewfinder = forwardRef<EquirectHandle, Props>(
  function EquirectViewfinder(
    { pano, fov = 1.15, locked = false, className, onLook },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<WebGLRenderingContext | null>(null);
    const ctx2dRef = useRef<CanvasRenderingContext2D | null>(null);
    const progRef = useRef<WebGLProgram | null>(null);
    const texRef = useRef<WebGLTexture | null>(null);
    const uniformsRef = useRef<{
      tex: WebGLUniformLocation | null;
      res: WebGLUniformLocation | null;
      yaw: WebGLUniformLocation | null;
      pitch: WebGLUniformLocation | null;
      fov: WebGLUniformLocation | null;
    } | null>(null);
    const panoRef = useRef<HTMLImageElement | null>(null);
    const texDirtyRef = useRef(true);
    const lookRef = useRef({ yaw: 0, pitch: 0 });
    const dragRef = useRef({ yaw: 0, pitch: 0 });
    const trackerRef = useRef(createLookTracker());
    const lockedRef = useRef(locked);
    const draggingRef = useRef<{
      id: number;
      x: number;
      y: number;
      yaw: number;
      pitch: number;
    } | null>(null);
    const animRef = useRef<number>(0);
    const onLookRef = useRef(onLook);
    onLookRef.current = onLook;
    const fovRef = useRef(fov);
    fovRef.current = fov;

    lockedRef.current = locked;
    if (panoRef.current !== pano) {
      panoRef.current = pano;
      texDirtyRef.current = true;
    }

    const applyLook = (yaw: number, pitch: number) => {
      lookRef.current = { yaw, pitch: clampPitch(pitch) };
      onLookRef.current?.(lookRef.current);
    };

    const uploadTex = () => {
      const gl = glRef.current;
      const tex = texRef.current;
      const img = panoRef.current;
      if (!gl || !tex || !img || !img.naturalWidth) return false;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texDirtyRef.current = false;
      return true;
    };

    const initGl = (canvas: HTMLCanvasElement, gl: WebGLRenderingContext) => {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      const prog = gl.createProgram();
      if (!prog) throw new Error("program");
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "link");
      }
      progRef.current = prog;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uniformsRef.current = {
        tex: gl.getUniformLocation(prog, "uTex"),
        res: gl.getUniformLocation(prog, "uRes"),
        yaw: gl.getUniformLocation(prog, "uYaw"),
        pitch: gl.getUniformLocation(prog, "uPitch"),
        fov: gl.getUniformLocation(prog, "uFov")
      };
      const tex = gl.createTexture();
      texRef.current = tex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([201, 214, 226, 255])
      );
      texDirtyRef.current = true;
      void canvas;
    };

    const applySize = (canvas: HTMLCanvasElement) => {
      const { w, h, cssW, cssH } = viewSize(canvas);
      const resized = canvas.width !== w || canvas.height !== h;
      if (resized) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      return { w, h, resized };
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h, resized } = applySize(canvas);
      const gl = glRef.current;
      if (resized && gl) {
        try {
          initGl(canvas, gl);
        } catch {
          glRef.current = null;
        }
      }

      const prog = progRef.current;
      const uniforms = uniformsRef.current;
      if (gl && prog && uniforms && glRef.current) {
        if (texDirtyRef.current) uploadTex();
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        if (texRef.current) gl.bindTexture(gl.TEXTURE_2D, texRef.current);
        gl.uniform1i(uniforms.tex, 0);
        gl.uniform2f(uniforms.res, w, h);
        gl.uniform1f(uniforms.yaw, lookRef.current.yaw);
        gl.uniform1f(uniforms.pitch, lookRef.current.pitch);
        gl.uniform1f(uniforms.fov, fovRef.current);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }

      const ctx = ctx2dRef.current;
      const img = panoRef.current;
      if (!ctx || !img) return;
      drawSoftware(
        ctx,
        img,
        lookRef.current.yaw,
        lookRef.current.pitch,
        fovRef.current,
        w,
        h
      );
    };

    useImperativeHandle(ref, () => ({
      getLook: () => ({ ...lookRef.current }),
      setLook: (yaw, pitch) => {
        dragRef.current = { yaw, pitch: clampPitch(pitch) };
        resetLookTracker(trackerRef.current);
        applyLook(yaw, clampPitch(pitch));
      },
      animateTo: (yaw, pitch, ms) =>
        new Promise((resolve) => {
          const from = { ...lookRef.current };
          const toYaw = from.yaw + angleDelta(yaw, from.yaw);
          const toPitch = clampPitch(pitch);
          const start = performance.now();
          const dur = Math.max(1, ms);
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur);
            const e = t * t * (3 - 2 * t);
            const ny = from.yaw + (toYaw - from.yaw) * e;
            const np = from.pitch + (toPitch - from.pitch) * e;
            dragRef.current = { yaw: ny, pitch: np };
            resetLookTracker(trackerRef.current);
            applyLook(ny, np);
            if (t < 1) animRef.current = requestAnimationFrame(tick);
            else resolve();
          };
          if (animRef.current) cancelAnimationFrame(animRef.current);
          animRef.current = requestAnimationFrame(tick);
        }),
      setLocked: (next) => {
        lockedRef.current = next;
        if (!next) {
          dragRef.current = { ...lookRef.current };
          resetLookTracker(trackerRef.current);
        }
      },
      recalibrate: () => {
        resetLookTracker(trackerRef.current);
        dragRef.current = { ...lookRef.current };
      },
      captureJpeg: async () => {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Viewfinder is not ready yet.");
        draw();
        return captureJpegFromCanvas(canvas);
      }
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      applySize(canvas);

      const gl = getGl(canvas);
      if (gl) {
        glRef.current = gl;
        try {
          initGl(canvas, gl);
        } catch {
          glRef.current = null;
        }
      }
      if (!glRef.current) {
        ctx2dRef.current = canvas.getContext("2d");
      }

      let raf = 0;
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      const ro = new ResizeObserver(() => draw());
      if (canvas.parentElement) ro.observe(canvas.parentElement);
      ro.observe(canvas);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const applyTracked = () => {
        const rel = trackerRef.current.filtered;
        if (!rel) return;
        applyLook(dragRef.current.yaw + rel.yaw, dragRef.current.pitch + rel.pitch);
      };

      const onOrient = (ev: DeviceOrientationEvent) => {
        if (lockedRef.current || draggingRef.current) return;
        const pose = readPose(ev);
        if (!pose) return;
        trackerPushOrientation(trackerRef.current, pose);
        applyTracked();
      };

      const onMotion = (ev: DeviceMotionEvent) => {
        if (lockedRef.current || draggingRef.current) return;
        const rate = ev.rotationRate;
        if (!rate) return;
        trackerPushGyro(trackerRef.current, rate, performance.now());
        applyTracked();
      };

      window.addEventListener("deviceorientation", onOrient, true);
      window.addEventListener("devicemotion", onMotion, true);
      return () => {
        window.removeEventListener("deviceorientation", onOrient, true);
        window.removeEventListener("devicemotion", onMotion, true);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (lockedRef.current) return;
      e.stopPropagation();
      (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
      draggingRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        yaw: lookRef.current.yaw,
        pitch: lookRef.current.pitch
      };
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const d = draggingRef.current;
      if (!d || d.id !== e.pointerId) return;
      e.stopPropagation();
      e.preventDefault();
      const canvas = canvasRef.current;
      const w = canvas?.clientWidth || 1;
      const h = canvas?.clientHeight || 1;
      const dx = (e.clientX - d.x) / w;
      const dy = (e.clientY - d.y) / h;
      const yaw = d.yaw - dx * fovRef.current * 1.6;
      const pitch = d.pitch + dy * fovRef.current * 1.2;
      dragRef.current = { yaw, pitch: clampPitch(pitch) };
      resetLookTracker(trackerRef.current);
      applyLook(dragRef.current.yaw, dragRef.current.pitch);
    };

    const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (draggingRef.current?.id !== e.pointerId) return;
      draggingRef.current = null;
      dragRef.current = { ...lookRef.current };
      resetLookTracker(trackerRef.current);
    };

    return (
      <canvas
        ref={canvasRef}
        className={className}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    );
  }
);

export default EquirectViewfinder;
