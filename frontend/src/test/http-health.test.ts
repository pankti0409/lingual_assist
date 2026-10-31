import { describe, expect, it, vi } from "vitest";
import { createHttpServices } from "@/api/http/httpServices";

describe("HTTP adapter: service health", () => {
  it("maps GET /health to the capabilities the UI shows", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: "ok", services: { elevenlabs: false, groq: true }, assets: { face_landmarker: true, gesture_recognizer: false } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices("http://api.test");
    expect(await services.connection.health()).toEqual({ suggestions: true, speech: false, vision: false });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/health", undefined);
    vi.unstubAllGlobals();
  });
});
