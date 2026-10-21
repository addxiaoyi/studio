let recorder;
let chunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === "recording.start") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } },
      });
      chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const buffer = await blob.arrayBuffer();
        let binary = "";
        for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
        await chrome.runtime.sendMessage({ type: "recording.complete", base64: `data:video/webm;base64,${btoa(binary)}` });
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start(1000);
      await chrome.runtime.sendMessage({ type: "recording.started" });
    } catch (error) {
      await chrome.runtime.sendMessage({ type: "recording.failed", message: error instanceof Error ? error.message : "录屏权限不可用" });
    }
  }
  if (message.type === "recording.stop" && recorder && recorder.state !== "inactive") recorder.stop();
});
