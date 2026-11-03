/* CPU-heavy image rasterization stays off the CRM interaction thread. */
self.onmessage = async (event) => {
  try {
    const { id, blob, maxWidth = 640, maxHeight = 320, type = "image/png", quality = 0.9 } = event.data || {};
    if (!id || !(blob instanceof Blob)) throw new Error("invalid_image_request");
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(Math.round(bitmap.width * scale), 1);
    const height = Math.max(Math.round(bitmap.height * scale), 1);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const output = await canvas.convertToBlob({ type, quality });
    const buffer = await output.arrayBuffer();
    self.postMessage({ id, buffer, type: output.type }, [buffer]);
  } catch (error) {
    self.postMessage({ id: event.data?.id || "", error: error?.message || "image_processing_failed" });
  }
};
