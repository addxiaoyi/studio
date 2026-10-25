import { ipcRenderer } from "electron";

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let streamRef: MediaStream | null = null;
let chunks: Blob[] = [];

function startRecording() {
  if (recorder && recorder.state !== "inactive") return;
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!canvas) return;
  stream = canvas.captureStream(5);
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const buffer = await blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    ipcRenderer.send("recorder.complete", btoa(binary));
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    chunks = [];
  };
  recorder.start(1_000);
}

ipcRenderer.on("recorder.start", startRecording);

async function startNativeRecording(sourceId: string, withAudio: boolean) {
  if (recorder && recorder.state !== "inactive") return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: withAudio
        ? {
            // @ts-expect-error Electron system audio loopback constraints are non-standard
            mandatory: {
              chromeMediaSource: "system",
            },
          }
        : false,
      video: {
        // @ts-expect-error Electron desktop capture constraints are non-standard
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxFrameRate: 10,
        },
      },
    });
    await attachNativeRecorder(stream, withAudio);
  } catch (error) {
    if (withAudio) {
      // System audio loopback is unsupported on some setups; retry video-only.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-expect-error Electron desktop capture constraints are non-standard
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              maxFrameRate: 10,
            },
          },
        });
        await attachNativeRecorder(stream, false);
        return;
      } catch {
        /* fall through to the failure report */
      }
    }
    streamRef?.getTracks().forEach((track) => track.stop());
    streamRef = null;
    recorder = null;
    chunks = [];
    ipcRenderer.send(
      "recorder.native-failed",
      error instanceof Error ? error.message : "screen capture unavailable",
    );
  }
}

async function attachNativeRecorder(stream: MediaStream, withAudio: boolean) {
  streamRef = stream;
  chunks = [];
  const codecs = withAudio ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8";
  const mimeType = MediaRecorder.isTypeSupported(codecs) ? codecs : "video/webm";
  recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const buffer = await blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    ipcRenderer.send("recorder.complete", btoa(binary));
    streamRef?.getTracks().forEach((track) => track.stop());
    streamRef = null;
    recorder = null;
    chunks = [];
  };
  recorder.start(1_000);
  ipcRenderer.send("recorder.native-started");
}

ipcRenderer.on("recorder.start-native", (_event, sourceId: string, withAudio: boolean) => {
  void startNativeRecording(sourceId, withAudio === true);
});
ipcRenderer.on("recorder.frame", (_event, base64: string) => {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const image = new Image();
  image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.src = `data:image/jpeg;base64,${base64}`;
});
ipcRenderer.on("recorder.stop", () => {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else if (streamRef) {
    const active = streamRef;
    streamRef = null;
    active.getTracks().forEach((track) => track.stop());
    ipcRenderer.send("recorder.complete", "");
  } else ipcRenderer.send("recorder.complete", "");
});
