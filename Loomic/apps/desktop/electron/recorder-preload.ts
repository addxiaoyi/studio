import { ipcRenderer } from "electron";

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
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
  else ipcRenderer.send("recorder.complete", "");
});
