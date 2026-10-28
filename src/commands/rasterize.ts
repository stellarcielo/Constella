// SVG の文字列を PNG のバイト列にする(ブラウザの画像描画を使う)。

export async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const image = new Image();
  // blob の URL だと Safari(WebKit)でキャンバスが読み出せなくなることがあるので、data URL にする
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を描く準備ができませんでした");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  // 図が大きすぎると、ブラウザの上限を超えて作れない
  if (!blob) throw new Error(`画像が大きすぎます(${canvas.width}×${canvas.height}px)`);
  return new Uint8Array(await blob.arrayBuffer());
}
