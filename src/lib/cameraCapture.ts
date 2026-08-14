/** Device camera helpers for in-app field notes. */

export type CameraDeviceInfo = {
  deviceId: string;
  label: string;
};

const CAMERA_PREF_KEY = "survey-report-camera-id";

export function loadPreferredCameraId(): string | null {
  try {
    return localStorage.getItem(CAMERA_PREF_KEY);
  } catch {
    return null;
  }
}

export function savePreferredCameraId(deviceId: string | null) {
  try {
    if (!deviceId) localStorage.removeItem(CAMERA_PREF_KEY);
    else localStorage.setItem(CAMERA_PREF_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

export async function listVideoCameras(): Promise<CameraDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label?.trim() || `Camera ${i + 1}`
    }));
}

export function isCameraAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const msg = "message" in err ? String((err as { message?: string }).message) : "";
  return (
    name === "AbortError" ||
    /aborted by the user agent/i.test(msg) ||
    /play\(\) request was interrupted/i.test(msg) ||
    /fetching process for the media resource was aborted/i.test(msg)
  );
}

export async function startCamera(
  video: HTMLVideoElement,
  deviceId?: string | null
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera is not available in this browser. Use Import field notes, or open the app on a device with a camera."
    );
  }

  const tryConstraints = async (
    videoConstraints: MediaTrackConstraints | boolean
  ): Promise<MediaStream> =>
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints
    });

  let stream: MediaStream;
  if (deviceId) {
    try {
      stream = await tryConstraints({
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      });
    } catch {
      stream = await tryConstraints({ deviceId: { exact: deviceId } });
    }
  } else {
    try {
      stream = await tryConstraints({
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      });
    } catch {
      stream = await tryConstraints(true);
    }
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch (err) {
    // A superseded play() (Strict Mode remount, device switch) aborts with this
    // message even when a later attempt succeeds. Retry once, then accept the
    // stream if the element is already showing frames.
    if (!isCameraAbortError(err)) throw err;
    if (video.srcObject !== stream) throw err;
    try {
      await video.play();
    } catch (retryErr) {
      if (!isCameraAbortError(retryErr)) throw retryErr;
      if (video.srcObject !== stream) throw retryErr;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && video.paused) {
        throw retryErr;
      }
    }
  }
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

export type CameraZoomRange = {
  min: number;
  max: number;
  step: number;
};

/** Hardware zoom range when the active track supports it. */
export function getCameraZoomRange(
  stream: MediaStream | null
): CameraZoomRange | null {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== "function") return null;
  const caps = track.getCapabilities() as MediaTrackCapabilities & {
    zoom?: { min?: number; max?: number; step?: number };
  };
  const z = caps.zoom;
  if (!z || z.min == null || z.max == null || z.max <= z.min) return null;
  return {
    min: z.min,
    max: z.max,
    step: z.step && z.step > 0 ? z.step : 0.1
  };
}

export async function applyCameraZoom(
  stream: MediaStream | null,
  zoom: number
): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== "function") return false;
  const range = getCameraZoomRange(stream);
  if (!range) return false;
  const clamped = Math.min(range.max, Math.max(range.min, zoom));
  try {
    await track.applyConstraints({
      // Chrome / Android expose zoom via advanced constraints.
      advanced: [{ zoom: clamped } as MediaTrackConstraintSet]
    });
    return true;
  } catch {
    try {
      await track.applyConstraints({
        zoom: clamped
      } as MediaTrackConstraints);
      return true;
    } catch {
      return false;
    }
  }
}

/** Capture the current video frame as JPEG bytes. */
export async function captureJpegFromVideo(
  video: HTMLVideoElement,
  quality = 0.88
): Promise<Uint8Array> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    throw new Error("Camera is not ready yet — wait a moment and try again.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not capture photo.");
  ctx.drawImage(video, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode photo."))),
      "image/jpeg",
      quality
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Capture a canvas (e.g. the tutorial 360 viewfinder) as JPEG bytes. */
export async function captureJpegFromCanvas(
  canvas: HTMLCanvasElement,
  quality = 0.88
): Promise<Uint8Array> {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) {
    throw new Error("Viewfinder is not ready yet — wait a moment and try again.");
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode photo."))),
      "image/jpeg",
      quality
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}
