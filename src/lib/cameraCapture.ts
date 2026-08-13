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
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
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
