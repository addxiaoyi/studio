"""OneTake ASR adapter and bounded, accurate FFmpeg export process."""

from __future__ import annotations

from array import array
from contextlib import redirect_stdout
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[5]
PACKAGED_SOURCE = Path(__file__).resolve().parent / "upstream/asr_demo.py"
SOURCE = Path(os.environ.get("HELSTERA_ONETAKE_SOURCE", PACKAGED_SOURCE if PACKAGED_SOURCE.is_file() else ROOT / "vendor/onetake/asr_demo.py"))
SOURCE_SHA = "9b002bd9f3245cd89446dbcd094059e4899d59851316b71186d3dea93f0a9b29"
FFMPEG = os.environ.get("HELSTERA_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("HELSTERA_FFPROBE", "ffprobe")
MAX_DURATION = 7200
LOCAL_MEDIA = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,wav,mp3,ogg,flac,aac"]


def run_tool(arguments: list[str], *, cwd: Path | None = None, timeout: int = 1800) -> str:
    process = subprocess.run(arguments, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if process.returncode:
        raise RuntimeError("Media tool failed: " + process.stderr[-1500:])
    return process.stdout


def inspect_media(path: str) -> dict:
    metadata = json.loads(run_tool([FFPROBE, "-v", "error", *LOCAL_MEDIA, "-show_format", "-show_streams", "-of", "json", path], timeout=30))
    duration = float(metadata.get("format", {}).get("duration", 0))
    if not 0 < duration <= MAX_DURATION:
        raise ValueError("音视频时长需介于 0 秒与 2 小时之间。")
    video = next((stream for stream in metadata["streams"] if stream["codec_type"] == "video"), {})
    return {"duration": duration, "audio": any(stream["codec_type"] == "audio" for stream in metadata["streams"]), "video": bool(video), "width": int(video.get("width", 0)), "height": int(video.get("height", 0))}


def upstream():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA:
        raise RuntimeError("OneTake source differs from the reviewed pinned version.")
    spec = importlib.util.spec_from_file_location("loomic_onetake_asr", SOURCE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def waveform(path: str, duration: float) -> list[float]:
    bins = 1200
    peaks = [0.0] * bins
    samples_per_bin = max(1, int(duration * 8000 / bins))
    process = subprocess.Popen([FFMPEG, "-v", "error", *LOCAL_MEDIA, "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    cursor = 0
    try:
        while chunk := process.stdout.read(16384):
            samples = array("f")
            samples.frombytes(chunk)
            for sample in samples:
                index = min(bins - 1, cursor // samples_per_bin)
                peaks[index] = max(peaks[index], min(1, abs(sample)))
                cursor += 1
        if process.wait(timeout=30):
            raise RuntimeError("无法读取音频波形。")
        return [round(peak, 4) for peak in peaks]
    finally:
        if process.poll() is None:
            process.kill()
        process.stdout.close()


def transcribe(request: dict) -> dict:
    path = str(Path(request["source"]).resolve(strict=True))
    media = inspect_media(path)
    if not media["audio"]:
        raise ValueError("所选素材没有音轨，无法进行语音转写。")
    model = request["model"]
    if model not in ("tiny", "base", "small", "medium", "large-v3"):
        raise ValueError("Unsupported transcription model.")
    with redirect_stdout(sys.stderr):
        source = upstream()
        device = os.environ.get("HELSTERA_ONETAKE_DEVICE", "cpu")
        engine = source.FasterWhisperASR(model_size=model, device=device, compute_type="int8" if device == "cpu" else "float16")
        words, _duration = engine.transcribe(path, language=None if request["language"] == "auto" else request["language"])
        source.FillerDetector().detect(words)
        silences = source.SilenceDetector(threshold=0.5).detect(words)
    normalized = []
    previous = 0.0
    for word in words:
        start = max(previous, float(word.start))
        end = min(media["duration"], float(word.end))
        if not word.word.strip() or end <= start:
            continue
        normalized.append({"text": word.word.strip(), "start": start, "end": end, "confidence": max(0, min(1, float(word.confidence))), "kind": word.type})
        previous = end
    if not normalized:
        raise ValueError("未检测到语音，请检查音轨或换用更准确的模型。")
    return {"duration": media["duration"], "words": normalized, "silences": [{"start": item.start, "end": item.end} for item in silences if 0 <= item.start < item.end <= media["duration"]], "peaks": waveform(path, media["duration"])}


def ass_color(color: str) -> str:
    return "&H00" + color[5:7] + color[3:5] + color[1:3]


def subtitle_dimensions(width: int, height: int, size: int | None) -> tuple[int, int]:
    portrait = height >= width
    font_size = size if size is not None else max(16, min(72, int(height * (0.04 if portrait else 0.05))))
    return font_size, int(height * (0.1 if portrait else 0.08))


def export(request: dict) -> dict:
    source = str(Path(request["source"]).resolve(strict=True))
    output = Path(request["output"]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    media = inspect_media(source)
    if not media["video"]:
        raise ValueError("请选择包含视频画面的素材。")
    compiled, options = request["compiled"], request["options"]
    segments = compiled["segments"]
    if not 0 < len(segments) <= 500:
        raise ValueError("Invalid export segment count.")
    filters, labels = [], []
    for index, segment in enumerate(segments):
        start, end = float(segment["start"]), float(segment["end"])
        if not 0 <= start < end <= media["duration"] + 0.001:
            raise ValueError("Export segment exceeds the media duration.")
        filters.append(f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{index}]")
        labels.append(f"[v{index}]")
        if media["audio"]:
            filters.append(f"[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{index}]")
            labels.append(f"[a{index}]")
    filters.append("".join(labels) + f"concat=n={len(segments)}:v=1:a={int(media['audio'])}[joined]" + ("[sound]" if media["audio"] else ""))
    aspect = options["aspect"]
    width, height = media["width"] // 2 * 2, media["height"] // 2 * 2
    scale = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    if aspect != "original":
        width, height = (720, 1280) if aspect == "portrait" else (1280, 720)
        scale = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    subtitle = options["subtitle"]
    caption_file = output.parent / "captions.srt"
    caption_file.write_text(compiled["srt"], encoding="utf-8")
    soft = subtitle["enabled"] and subtitle["mode"] == "soft"
    if subtitle["enabled"] and not soft:
        position = {"bottom": 2, "center": 5, "top": 8}[subtitle["position"]]
        font_size, margin = subtitle_dimensions(width, height, subtitle["size"])
        style = f"PlayResX={width},PlayResY={height},FontName={subtitle['font']},FontSize={font_size},PrimaryColour={ass_color(subtitle['color'])},OutlineColour={ass_color(subtitle['outlineColor'])},Outline={subtitle['outlineWidth']},Alignment={position},MarginV={margin}"
        scale += f",subtitles=filename=captions.srt:force_style='{style}'"
    filters.append(f"[joined]{scale},format=yuv420p[out]")
    graph = output.parent / "filters.txt"
    graph.write_text(";\n".join(filters), encoding="utf-8")
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", *LOCAL_MEDIA, "-i", source]
    if soft:
        args.extend(["-i", str(caption_file)])
    # FFmpeg 9 removed the old spelling; retain compatibility with older servers.
    help_text = run_tool([FFMPEG, "-hide_banner", "-h", "full"], timeout=15)
    graph_option = "-filter_complex_script" if "-filter_complex_script " in help_text else "-/filter_complex"
    args.extend([graph_option, str(graph), "-map", "[out]"])
    if media["audio"]:
        args.extend(["-map", "[sound]", "-c:a", "aac", "-b:a", "192k"])
    if soft:
        args.extend(["-map", "1:0", "-c:s", "mov_text"])
    quality = {"low": "28", "medium": "23", "high": "18"}[options["quality"]]
    args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", quality, "-threads", "2"])
    if options["format"] != "avi":
        args.extend(["-movflags", "+faststart"])
    args.extend(["-y", str(output)])
    run_tool(args, cwd=output.parent)
    verified = inspect_media(str(output))
    if output.stat().st_size < 1024 or abs(verified["duration"] - compiled["duration"]) > 0.25:
        raise RuntimeError("导出文件不完整或时长与计划不符。")
    return {"bytes": output.stat().st_size, "duration": verified["duration"]}


def probe() -> dict:
    with redirect_stdout(sys.stderr):
        upstream()
    filters = run_tool([FFMPEG, "-hide_banner", "-filters"], timeout=15)
    run_tool([FFPROBE, "-version"], timeout=15)
    return {"available": True, "burnSubtitles": " subtitles " in filters, "sourceCommit": "3a49104e2dfb9f2c7833e0ca7e1adfc4a07826d8"}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        mode = request.get("operation")
        if mode not in ("probe", "transcribe", "export"):
            raise ValueError("Unsupported OneTake operation.")
        payload = probe() if mode == "probe" else transcribe(request) if mode == "transcribe" else export(request)
        print(json.dumps(payload, ensure_ascii=False))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
