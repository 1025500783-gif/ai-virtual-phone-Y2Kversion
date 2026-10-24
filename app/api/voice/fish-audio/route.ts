import { fishAudioSpeechRequest } from "@/lib/fish-audio-protocol";
import { fishAudioFetch } from "@/lib/server/fish-audio-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function fail(error: string, status: number) { return Response.json({ error }, { status, headers: responseHeaders }); }

export async function POST(request: Request): Promise<Response> {
    // Forward only the credentials and selected model supplied by this request.
    const origin = request.headers.get("origin");
    // Next's custom server reconstructs request.url with its internal hostname.
    // Compare the browser's origin with the actual HTTP Host, including LAN ports.
    if (origin) {
        try {
            const source = new URL(origin);
            const host = request.headers.get("host") || new URL(request.url).host;
            if (!["http:", "https:"].includes(source.protocol) || source.origin !== origin || source.host.toLowerCase() !== host.toLowerCase()) return fail("invalid_origin", 403);
        } catch { return fail("invalid_origin", 403); }
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 110_000);
    try {
        if (request.signal.aborted) { controller.abort(); return fail("fish_cancelled", 499); }
        const raw = await request.text();
        if (raw.length > 256_000) return fail("request_too_large", 413);
        let data;
        try { data = JSON.parse(raw); } catch { return fail("invalid_request", 400); }
        if (!data || typeof data.text !== "string" || !data.text.trim() || typeof data.reference_id !== "string") return fail("invalid_request", 400);
        const auth = request.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer ") || !auth.slice(7).trim()) return fail("missing_api_key", 400);
        let upstream;
        try {
            upstream = fishAudioSpeechRequest(data.text, {
                id: "relay", provider: "FishAudio", model: request.headers.get("model") || "",
                apiKey: auth.slice(7), defaultVoice: data.reference_id, enableTTS: true, enableSTT: false,
            });
        } catch { return fail("invalid_model_or_voice", 400); }
        // Fixed endpoint and canonical payload; caller cannot supply a URL or override headers.
        const response = await fishAudioFetch(upstream.url, { method: "POST", headers: upstream.headers, body: JSON.stringify(upstream.body), signal: controller.signal, redirect: "error", cache: "no-store" });
        if (!response.ok) {
            await response.body?.cancel();
            return fail("fish_upstream_error", response.status);
        }
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (!type.startsWith("audio/") && !type.startsWith("application/octet-stream")) { await response.body?.cancel(); return fail("fish_invalid_audio", 502); }
        const audio = await response.arrayBuffer();
        if (!audio.byteLength) return fail("fish_empty_audio", 502);
        if (controller.signal.aborted) return fail("fish_cancelled", 499);
        return new Response(audio, { headers: { ...responseHeaders, "Content-Type": "audio/mpeg" } });
    } catch {
        return fail(controller.signal.aborted ? "fish_timeout" : "fish_network_error", controller.signal.aborted ? 504 : 502);
    } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
    }
}
