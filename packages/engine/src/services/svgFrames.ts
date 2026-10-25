import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FRAME_FILENAME_PREFIX, frameSequencePath } from "./extractedFrameIndex.js";

const PARTS_DIR = "svg-parts";
const WRAP_CONCURRENCY = 8;

export function svgPartsDir(frameDir: string): string {
  return join(frameDir, PARTS_DIR);
}

export async function prepareSvgParts(frameDir: string): Promise<void> {
  await mkdir(svgPartsDir(frameDir), { recursive: true });
}

/** Outputs of one ffmpeg run: JPEG colour and gray alpha from a single decode. `shared` runs before the split. */
export function svgOutputArgs(input: {
  frameDir: string;
  shared: readonly string[];
  colourFilter: string;
  jpegQuality: string;
  perOutput: readonly string[];
}): string[] {
  const { frameDir, shared, colourFilter, jpegQuality, perOutput } = input;
  const parts = svgPartsDir(frameDir);
  const graph = `[0:v]${shared.join(",")},split[c][a];[c]${colourFilter}[rgb];[a]alphaextract,format=gray[al]`;
  return [
    ...["-filter_complex", graph],
    ...["-map", "[rgb]", ...perOutput, "-q:v", jpegQuality],
    ...["-y", frameSequencePath(parts, "rgb_%05d.jpg")],
    ...["-map", "[al]", ...perOutput, "-compression_level", "1"],
    ...["-y", frameSequencePath(parts, "matte_%05d.png")],
  ];
}

function svgFrame(jpeg: Buffer, matte: Buffer): string {
  const width = matte.readUInt32BE(16);
  const height = matte.readUInt32BE(20);
  const size = `width="${width}" height="${height}"`;
  const image = (type: string, bytes: Buffer) =>
    `<image ${size} href="data:image/${type};base64,${bytes.toString("base64")}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${width} ${height}">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" ${size}>${image("png", matte)}/></mask>` +
    `${image("jpeg", jpeg)} mask="url(#m)"/></svg>`
  );
}

/** Joins each colour frame with its matte into one `frame_NNNNN.svg`, then drops the parts. */
export async function wrapSvgFrames(frameDir: string): Promise<void> {
  const parts = svgPartsDir(frameDir);
  const numbers = (await readdir(parts))
    .filter((name) => name.startsWith("rgb_"))
    .map((name) => name.slice(4, -4));
  for (let at = 0; at < numbers.length; at += WRAP_CONCURRENCY) {
    await Promise.all(
      numbers.slice(at, at + WRAP_CONCURRENCY).map(async (number) => {
        const [jpeg, matte] = await Promise.all([
          readFile(join(parts, `rgb_${number}.jpg`)),
          readFile(join(parts, `matte_${number}.png`)),
        ]);
        await writeFile(
          join(frameDir, `${FRAME_FILENAME_PREFIX}${number}.svg`),
          svgFrame(jpeg, matte),
        );
      }),
    );
  }
  await rm(parts, { recursive: true, force: true });
}
