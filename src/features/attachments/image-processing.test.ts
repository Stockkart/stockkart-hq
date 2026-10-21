import { describe, expect, it } from "vitest";

import { chooseEncoding, MAX_IMAGE_EDGE, planImage, withExtension } from "./image-processing";

describe("planImage (ISS-9 resize decision)", () => {
  it("keeps GIFs and other types as they are", () => {
    expect(planImage({ mime: "image/gif", width: 5000, height: 4000 })).toEqual({ kind: "keep" });
    expect(planImage({ mime: "image/svg+xml", width: 5000, height: 10 })).toEqual({
      kind: "keep",
    });
    expect(planImage({ mime: "application/pdf", width: 1, height: 1 })).toEqual({ kind: "keep" });
  });

  it("keeps images whose size could not be read", () => {
    expect(planImage({ mime: "image/png", width: 0, height: 0 })).toEqual({ kind: "keep" });
  });

  it("re-encodes small PNG/JPEG/WebP at their own size", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "IMAGE/PNG"]) {
      expect(planImage({ mime, width: 1280, height: 720 })).toEqual({
        kind: "encode",
        width: 1280,
        height: 720,
        resized: false,
      });
    }
    expect(planImage({ mime: "image/png", width: MAX_IMAGE_EDGE, height: 10 })).toMatchObject({
      resized: false,
    });
  });

  it("downscales the long edge to 2560 px, keeping the aspect ratio", () => {
    expect(planImage({ mime: "image/png", width: 5120, height: 2880 })).toEqual({
      kind: "encode",
      width: 2560,
      height: 1440,
      resized: true,
    });
    // Portrait: the height is the long edge.
    expect(planImage({ mime: "image/jpeg", width: 3000, height: 6000 })).toEqual({
      kind: "encode",
      width: 1280,
      height: 2560,
      resized: true,
    });
    // A very thin strip never rounds down to 0 px.
    expect(planImage({ mime: "image/png", width: 100_000, height: 1 })).toMatchObject({
      width: 2560,
      height: 1,
    });
  });
});

describe("chooseEncoding", () => {
  it("uses WebP only when it is smaller than an image that needed no resize", () => {
    const base = { resized: false, originalBytes: 1000, sameFormatBytes: null };
    expect(chooseEncoding({ ...base, webpBytes: 400 })).toBe("webp");
    expect(chooseEncoding({ ...base, webpBytes: 1000 })).toBe("original");
    expect(chooseEncoding({ ...base, webpBytes: 2000 })).toBe("original");
    expect(chooseEncoding({ ...base, webpBytes: null })).toBe("original");
  });

  it("always uses a resized copy when one was needed, WebP when smaller", () => {
    const base = { resized: true, originalBytes: 9_000_000 };
    expect(chooseEncoding({ ...base, webpBytes: 300, sameFormatBytes: 900 })).toBe("webp");
    expect(chooseEncoding({ ...base, webpBytes: 900, sameFormatBytes: 300 })).toBe("sameFormat");
    // No WebP encoder (older Safari): the same format at the new size.
    expect(chooseEncoding({ ...base, webpBytes: null, sameFormatBytes: 300 })).toBe("sameFormat");
    expect(chooseEncoding({ ...base, webpBytes: 300, sameFormatBytes: null })).toBe("webp");
    expect(chooseEncoding({ ...base, webpBytes: null, sameFormatBytes: null })).toBe("original");
  });
});

describe("withExtension", () => {
  it("swaps or adds the extension", () => {
    expect(withExtension("Screenshot 1.png", "webp")).toBe("Screenshot 1.webp");
    expect(withExtension("image", "webp")).toBe("image.webp");
    expect(withExtension(".hidden", "webp")).toBe(".hidden.webp");
  });
});
