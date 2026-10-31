"""Vision cues from MediaPipe (blueprint §04-B face/mouth, §04-C gestures).

Only derived features are kept - never raw frames (I3, M4 spec). Cues come from short
time windows, never a single face frame (I6); no emotion or lip-reading claims (I5).
Gesture meaning comes from a per-session map (I7).
"""
from __future__ import annotations

import logging
import math
import threading
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional, Protocol

import anyio.to_thread
import asyncio
import cv2
import numpy as np
from pydantic import BaseModel
from starlette.requests import HTTPConnection

from config import Settings
from errors import AppError
from state.sessions import Session

logger = logging.getLogger("ps16.vision")

GESTURE_LABELS = (
    "Closed_Fist", "Open_Palm", "Pointing_Up", "Thumb_Down", "Thumb_Up", "Victory", "ILoveYou", "None",
)
DEFAULT_GESTURE_MAP = {"Thumb_Up": "yes", "Open_Palm": "pause", "Thumb_Down": "no"}  # demo only (I7)
MAX_MEANING_CHARS = 40

# STARTING values, not validated results.
MAX_SIDE_PX = 640
MIN_WINDOW_FRAMES = 4          # frames needed in a window before mouth/nod can be True
MOUTH_DELTA_THRESHOLD = 0.08   # frame-to-frame change in the mouth signal that counts as a movement
MOUTH_MIN_TRANSITIONS = 3      # a single open-close spike makes only 2 transitions
NOD_MIN_DEG = 4.0              # pitch swing that counts as one nod movement
NOD_MIN_SWINGS = 3             # tilt-and-return is 2 swings; a nod oscillates

Mode = Literal["image", "live"]


# ---- derived observations -------------------------------------------------------------
@dataclass(frozen=True)
class FaceObs:
    mouth: dict[str, float]
    pitch_deg: Optional[float]


@dataclass(frozen=True)
class GestureObs:
    label: str
    score: float
    handedness: Optional[str]


@dataclass(frozen=True)
class FrameObs:
    timestamp_ms: int
    face: Optional[FaceObs]
    gesture: Optional[GestureObs]


# ---- response models ------------------------------------------------------------------
class FaceCue(BaseModel):
    detected: bool
    mouth_activity: bool
    mouth_score: float
    head_nod: bool


class GestureCue(BaseModel):
    label: str
    score: float
    handedness: Optional[str] = None
    stable: bool
    meaning: Optional[str] = None


class Cue(BaseModel):
    timestamp_ms: int
    face: FaceCue
    gesture: Optional[GestureCue] = None


# ---- tracker (pure logic, no MediaPipe) -------------------------------------------------
def _mouth_signal(m: dict[str, float]) -> float:
    stretch = (m.get("mouthStretchLeft", 0.0) + m.get("mouthStretchRight", 0.0)) / 2
    return m.get("jawOpen", 0.0) + m.get("mouthFunnel", 0.0) + stretch - m.get("mouthClose", 0.0)


def mouth_activity(signal: list[float]) -> tuple[bool, float]:
    """Windowed: needs several frames and repeated movement; one open frame is not activity."""
    if len(signal) < MIN_WINDOW_FRAMES:
        return False, 0.0
    deltas = [abs(b - a) for a, b in zip(signal, signal[1:])]
    score = sum(deltas) / len(deltas)
    transitions = sum(d >= MOUTH_DELTA_THRESHOLD for d in deltas)
    return transitions >= MOUTH_MIN_TRANSITIONS, round(min(score, 1.0), 3)


def count_swings(values: list[float], threshold: float) -> int:
    """Count direction changes of at least `threshold` (zig-zag with hysteresis)."""
    if not values:
        return 0
    ext, direction, swings = values[0], 0, 0
    for v in values[1:]:
        if direction == 0:
            if abs(v - ext) >= threshold:
                direction, swings, ext = (1 if v > ext else -1), 1, v
        elif direction == 1:
            if v > ext:
                ext = v
            elif ext - v >= threshold:
                direction, swings, ext = -1, swings + 1, v
        else:
            if v < ext:
                ext = v
            elif v - ext >= threshold:
                direction, swings, ext = 1, swings + 1, v
    return swings


class CueTracker:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._frames: deque[FrameObs] = deque(maxlen=128)

    @property
    def last_timestamp_ms(self) -> Optional[int]:
        return self._frames[-1].timestamp_ms if self._frames else None

    def observe(self, obs: FrameObs) -> None:
        if self._frames and obs.timestamp_ms < self._frames[-1].timestamp_ms:
            obs = FrameObs(self._frames[-1].timestamp_ms, obs.face, obs.gesture)
        self._frames.append(obs)

    def clear(self) -> None:
        self._frames.clear()

    def current(self, now_ms: int, gesture_map: dict[str, str]) -> Optional[Cue]:
        """Cue as of the latest frame; None if there is none or it is older than CUE_MAX_AGE_MS."""
        if not self._frames:
            return None
        last = self._frames[-1]
        if now_ms - last.timestamp_ms > self._s.cue_max_age_ms:
            return None
        return self._cue(last, gesture_map)

    def _window(self, ms: int) -> list[FrameObs]:
        t0 = self._frames[-1].timestamp_ms - ms
        return [f for f in self._frames if f.timestamp_ms >= t0]

    def _cue(self, last: FrameObs, gesture_map: dict[str, str]) -> Cue:
        face_frames = [f.face for f in self._window(self._s.mouth_window_ms) if f.face and f.face.mouth]
        active, score = mouth_activity([_mouth_signal(f.mouth) for f in face_frames])
        pitches = [
            f.face.pitch_deg
            for f in self._window(self._s.head_nod_window_ms)
            if f.face and f.face.pitch_deg is not None
        ]
        nod = len(pitches) >= MIN_WINDOW_FRAMES and count_swings(pitches, NOD_MIN_DEG) >= NOD_MIN_SWINGS
        return Cue(
            timestamp_ms=last.timestamp_ms,
            face=FaceCue(
                detected=last.face is not None,
                mouth_activity=active and last.face is not None,
                mouth_score=score if last.face is not None else 0.0,
                head_nod=nod and last.face is not None,
            ),
            gesture=self._gesture(last, gesture_map),
        )

    def _gesture(self, last: FrameObs, gesture_map: dict[str, str]) -> Optional[GestureCue]:
        g = last.gesture
        s = self._s
        if g is None or g.label == "None" or g.score < s.gesture_min_score:
            return None
        tail = list(self._frames)[-s.gesture_stability_frames:]
        stable = len(tail) == s.gesture_stability_frames and all(
            f.gesture is not None
            and f.gesture.label == g.label
            and f.gesture.score >= s.gesture_min_score
            and last.timestamp_ms - f.timestamp_ms <= s.cue_max_age_ms
            for f in tail
        )
        return GestureCue(
            label=g.label,
            score=round(g.score, 3),
            handedness=g.handedness,
            stable=stable,
            meaning=gesture_map.get(g.label),
        )


# ---- backends ---------------------------------------------------------------------------
class VisionBackend(Protocol):
    def analyze(self, rgb: np.ndarray, timestamp_ms: int) -> Optional[FrameObs]:
        """Blocking. IMAGE backends always return an observation; LIVE_STREAM backends return
        the newest completed one (possibly for an earlier frame) or None."""
        ...

    def close(self) -> None: ...


class BackendFactory(Protocol):
    def create(self, mode: Mode) -> VisionBackend: ...


def face_obs_from_result(result: Any) -> Optional[FaceObs]:
    """FaceLandmarkerResult -> FaceObs. Pitch comes from the 4x4 transformation matrix; only its
    oscillation matters (nod detection), so the exact axis convention is not significant."""
    if not getattr(result, "face_landmarks", None):
        return None
    mouth: dict[str, float] = {}
    shapes = getattr(result, "face_blendshapes", None)
    if shapes:
        wanted = {"jawOpen", "mouthClose", "mouthFunnel", "mouthStretchLeft", "mouthStretchRight"}
        mouth = {c.category_name: float(c.score) for c in shapes[0] if c.category_name in wanted}
    pitch: Optional[float] = None
    mats = getattr(result, "facial_transformation_matrixes", None)
    if mats is not None and len(mats) > 0:
        m = np.asarray(mats[0], dtype=float)
        pitch = math.degrees(math.atan2(m[2][1], m[2][2]))
    return FaceObs(mouth=mouth, pitch_deg=pitch)


def gesture_obs_from_result(result: Any) -> Optional[GestureObs]:
    gestures = getattr(result, "gestures", None)
    if not gestures or not gestures[0]:
        return None
    top = gestures[0][0]
    hand = None
    handed = getattr(result, "handedness", None)
    if handed and handed[0]:
        hand = handed[0][0].category_name
    return GestureObs(label=top.category_name, score=float(top.score), handedness=hand)


class LiveMerger:
    """Joins the face and gesture callbacks of the same frame; newest completed frame wins."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._partial: dict[int, dict[str, Any]] = {}
        self._ready: Optional[FrameObs] = None

    def store(self, ts: int, key: Literal["face", "gesture"], value: Any) -> None:
        with self._lock:
            part = self._partial.setdefault(ts, {})
            part[key] = value
            if len(part) == 2:
                if self._ready is None or ts > self._ready.timestamp_ms:
                    self._ready = FrameObs(ts, part["face"], part["gesture"])
                for old in [k for k in self._partial if k <= ts]:
                    del self._partial[old]
            while len(self._partial) > 32:
                del self._partial[min(self._partial)]

    def take(self) -> Optional[FrameObs]:
        with self._lock:
            ready, self._ready = self._ready, None
            return ready


class MediaPipeBackend:
    """IMAGE mode (stateless, blocking) or LIVE_STREAM mode (async callbacks)."""

    def __init__(self, face_model: Path, gesture_model: Path, mode: Mode) -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        self._mode = mode
        self._last_ts = -1
        self._merger = LiveMerger()
        running = vision.RunningMode.IMAGE if mode == "image" else vision.RunningMode.LIVE_STREAM
        face_kw: dict[str, Any] = {}
        gest_kw: dict[str, Any] = {}
        if mode == "live":
            face_kw["result_callback"] = lambda r, img, ts: self._merger.store(ts, "face", face_obs_from_result(r))
            gest_kw["result_callback"] = lambda r, img, ts: self._merger.store(ts, "gesture", gesture_obs_from_result(r))
        self._face = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(face_model)),
                running_mode=running,
                num_faces=1,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                **face_kw,
            )
        )
        self._gest = vision.GestureRecognizer.create_from_options(
            vision.GestureRecognizerOptions(
                base_options=BaseOptions(model_asset_path=str(gesture_model)),
                running_mode=running,
                num_hands=1,
                **gest_kw,
            )
        )

    def analyze(self, rgb: np.ndarray, timestamp_ms: int) -> Optional[FrameObs]:
        # SRGB means RGB order; the caller has already converted from OpenCV's BGR.
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        if self._mode == "image":
            return FrameObs(
                timestamp_ms,
                face_obs_from_result(self._face.detect(image)),
                gesture_obs_from_result(self._gest.recognize(image)),
            )
        ts = max(timestamp_ms, self._last_ts + 1)  # LIVE_STREAM timestamps must strictly increase
        self._last_ts = ts
        self._face.detect_async(image, ts)
        self._gest.recognize_async(image, ts)
        return self._merger.take()

    def close(self) -> None:
        for task in (self._face, self._gest):
            try:
                task.close()
            except Exception:
                logger.exception("failed to close MediaPipe task")


class MediaPipeBackendFactory:
    def __init__(self, settings: Settings) -> None:
        self._dir = settings.assets_dir

    def create(self, mode: Mode) -> VisionBackend:
        face = self._dir / "face_landmarker.task"
        gesture = self._dir / "gesture_recognizer.task"
        missing = [p.name for p in (face, gesture) if not p.is_file()]
        if missing:
            raise AppError(503, "not_configured", f"MediaPipe model file(s) missing in assets/: {', '.join(missing)}")
        return MediaPipeBackend(face, gesture, mode)


def get_backend_factory(request: HTTPConnection) -> BackendFactory:
    return MediaPipeBackendFactory(request.app.state.settings)


# ---- per-session state ------------------------------------------------------------------
@dataclass
class VisionSession:
    tracker: CueTracker
    gesture_map: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_GESTURE_MAP))
    backends: dict[str, VisionBackend] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    dropped_frames: int = 0


class VisionRegistry:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._sessions: dict[str, VisionSession] = {}

    def for_session(self, session_id: str) -> VisionSession:
        vs = self._sessions.get(session_id)
        if vs is None:
            vs = self._sessions[session_id] = VisionSession(CueTracker(self._settings))
        return vs

    def has(self, session_id: str) -> bool:
        return session_id in self._sessions

    def close_session(self, session: Session) -> None:
        """Session cleanup hook: close MediaPipe objects and drop derived cues."""
        vs = self._sessions.pop(session.session_id, None)
        if vs is None:
            return
        for backend in vs.backends.values():
            try:
                backend.close()
            except Exception:
                logger.exception("failed to close vision backend")
        vs.backends.clear()
        vs.tracker.clear()


def decode_frame(data: bytes) -> np.ndarray:
    """Decode JPEG/PNG, downscale, and convert OpenCV BGR -> RGB for mediapipe.Image."""
    if not data:
        raise AppError(422, "validation_error", "Empty image")
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise AppError(422, "validation_error", "Could not decode image (expected JPEG or PNG)")
    h, w = img.shape[:2]
    scale = MAX_SIDE_PX / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


async def process_frame(
    vs: VisionSession,
    session: Session,
    data: bytes,
    factory: BackendFactory,
    mode: Mode = "image",
    timestamp_ms: Optional[int] = None,
) -> Optional[Cue]:
    """Decode one frame, run the backend off the event loop, update the tracker, return the cue."""
    ts = session.clock.now_ms() if timestamp_ms is None else timestamp_ms
    rgb = decode_frame(data)
    async with vs.lock:
        backend = vs.backends.get(mode)
        if backend is None:
            backend = await anyio.to_thread.run_sync(factory.create, mode)
            vs.backends[mode] = backend
        obs = await anyio.to_thread.run_sync(backend.analyze, rgb, ts)
        if obs is not None:
            vs.tracker.observe(obs)
        return vs.tracker.current(ts, vs.gesture_map)
