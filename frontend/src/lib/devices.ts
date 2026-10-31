/** Microphone / camera availability checks. Nothing is recorded: tracks are stopped immediately. */
export type DeviceCheck = "idle" | "checking" | "ready" | "denied" | "unavailable" | "unsupported";
export type DeviceKind = "microphone" | "camera";

export async function checkDevice(kind: DeviceKind): Promise<Exclude<DeviceCheck, "idle" | "checking">> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
    stream.getTracks().forEach((t) => t.stop());
    return "ready";
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    return "unavailable";
  }
}

export const DEVICE_MESSAGES: Record<DeviceKind, Record<Exclude<DeviceCheck, "idle">, { title: string; body: string }>> = {
  microphone: {
    checking: { title: "Checking the microphone…", body: "Your browser may ask for permission." },
    ready: { title: "Microphone ready", body: "It was opened and closed again. Nothing was recorded." },
    denied: { title: "Microphone permission denied", body: "Allow microphone access in your browser’s site settings, or continue by typing." },
    unavailable: { title: "No microphone available", body: "Connect a microphone and check again, or continue by typing." },
    unsupported: { title: "Microphone not supported here", body: "This browser can’t open a microphone. Typing works without one." },
  },
  camera: {
    checking: { title: "Checking the camera…", body: "Your browser may ask for permission." },
    ready: { title: "Camera ready", body: "It was opened and closed again. No image was captured." },
    denied: { title: "Camera permission denied", body: "Allow camera access in your browser’s site settings. Visual cues are optional." },
    unavailable: { title: "No camera available", body: "Connect a camera and check again. Visual cues are optional." },
    unsupported: { title: "Camera not supported here", body: "This browser can’t open a camera. Everything else still works." },
  },
};
