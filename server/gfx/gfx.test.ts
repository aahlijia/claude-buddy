import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import { BLOB_H, BLOB_W, blinkAt, blobPose, renderBlob } from "./blob.ts";
import { detectTier, tmuxWrap } from "./detect.ts";
import { easeInOutCubic, easeOutBack, springDecay } from "./ease.ts";
import { encodeHalfblock, to256 } from "./encode/halfblock.ts";
import { encodeIterm } from "./encode/iterm.ts";
import { encodeKitty, KITTY_CHUNK } from "./encode/kitty.ts";
import { crc32, encodePng } from "./encode/png.ts";
import { Framebuffer, blit, hex, sprite, type RGBA } from "./framebuffer.ts";

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

/** Decode truecolor half-block lines back into pixels (null = terminal bg). */
function decodeHalfblock(lines: string[], width: number): (RGBA | null)[][] {
  const rows: (RGBA | null)[][] = [];
  for (const line of lines) {
    const top: (RGBA | null)[] = [];
    const bot: (RGBA | null)[] = [];
    let fg: RGBA | null = null;
    let bg: RGBA | null = null;
    const re = /\x1b\[([0-9;]*)m|([^\x1b])/gu;
    for (const m of line.matchAll(re)) {
      if (m[1] !== undefined) {
        const p = m[1].split(";").map(Number);
        fg = bg = null;
        for (let i = 0; i < p.length; i++) {
          if (p[i] === 38 && p[i + 1] === 2) fg = [p[i + 2], p[i + 3], p[i + 4], 255];
          if (p[i] === 48 && p[i + 1] === 2) bg = [p[i + 2], p[i + 3], p[i + 4], 255];
        }
        continue;
      }
      const ch = m[2];
      if (ch === " ") (top.push(null), bot.push(null));
      else if (ch === "█") (top.push(fg), bot.push(fg));
      else if (ch === "▀") (top.push(fg), bot.push(bg));
      else if (ch === "▄") (top.push(bg), bot.push(fg));
    }
    expect(top.length).toBe(width);
    rows.push(top, bot);
  }
  return rows;
}

describe("framebuffer", () => {
  test("blend composites source-over", () => {
    const fb = new Framebuffer(1, 1);
    fb.set(0, 0, BLUE);
    fb.blend(0, 0, [255, 0, 0, 128]);
    const [r, g, b, a] = fb.get(0, 0);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(b).toBeGreaterThan(120);
    expect(g).toBe(0);
  });

  test("out-of-bounds access is ignored", () => {
    const fb = new Framebuffer(2, 2);
    fb.set(-1, 5, RED);
    fb.blend(9, 9, RED);
    expect(fb.get(-1, 0)).toEqual([0, 0, 0, 0]);
  });

  test("sprites: '.' is transparent, flipX mirrors", () => {
    const s = sprite(["r."], { r: RED });
    const fb = new Framebuffer(2, 1);
    blit(fb, s, 0, 0);
    expect(fb.get(0, 0)).toEqual(RED);
    expect(fb.get(1, 0)[3]).toBe(0);
    const flipped = new Framebuffer(2, 1);
    blit(flipped, s, 0, 0, { flipX: true });
    expect(flipped.get(1, 0)).toEqual(RED);
  });

  test("upscale is nearest-neighbor", () => {
    const fb = new Framebuffer(2, 1);
    fb.set(0, 0, RED);
    fb.set(1, 0, BLUE);
    const up = fb.upscale(3);
    expect([up.width, up.height]).toEqual([6, 3]);
    expect(up.get(2, 2)).toEqual(RED);
    expect(up.get(3, 0)).toEqual(BLUE);
  });

  test("hex parses rgb and rgba", () => {
    expect(hex("#ff8000")).toEqual([255, 128, 0, 255]);
    expect(hex("10203040")).toEqual([16, 32, 48, 64]);
  });
});

describe("ease", () => {
  test("curves hit their endpoints", () => {
    for (const f of [easeInOutCubic, easeOutBack]) {
      expect(f(0)).toBeCloseTo(0);
      expect(f(1)).toBeCloseTo(1);
    }
    expect(springDecay(0)).toBe(1);
    expect(Math.abs(springDecay(3))).toBeLessThan(0.01);
  });
});

describe("half-block encoder", () => {
  test("round-trips pixels through ▀/▄/█ cells", () => {
    const fb = new Framebuffer(4, 3);
    fb.set(0, 0, RED); // top only
    fb.set(1, 1, BLUE); // bottom only
    fb.set(2, 0, RED);
    fb.set(2, 1, BLUE); // both, different
    fb.set(3, 0, RED);
    fb.set(3, 1, RED); // both, same
    fb.set(0, 2, BLUE); // odd last row
    const lines = encodeHalfblock(fb);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("█");
    expect(lines[0]).toContain("▄");
    const px = decodeHalfblock(lines, 4);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const c = fb.get(x, y);
        expect(px[y][x]).toEqual(c[3] ? c : null);
      }
    }
  });

  test("a whole blob frame round-trips exactly", () => {
    const fb = renderBlob(1.7, { rarity: "legendary", backdrop: true });
    const px = decodeHalfblock(encodeHalfblock(fb), BLOB_W);
    for (let y = 0; y < BLOB_H; y++) for (let x = 0; x < BLOB_W; x++) expect(px[y][x]).toEqual(fb.get(x, y));
  });

  test("background option makes every cell opaque", () => {
    const lines = encodeHalfblock(new Framebuffer(3, 2), { background: [10, 20, 30, 255] });
    expect(lines[0]).not.toContain(" ");
  });

  test("256-color mode emits palette indices", () => {
    const fb = new Framebuffer(1, 2);
    fb.set(0, 0, RED);
    fb.set(0, 1, BLUE);
    const [line] = encodeHalfblock(fb, { color: "256" });
    expect(line).toContain("38;5;196");
    expect(line).toContain("48;5;21");
    expect(line).not.toContain("38;2;");
    expect(to256(128, 128, 128)).toBeGreaterThanOrEqual(232);
  });
});

describe("pixel encoders", () => {
  test("PNG has a valid signature, CRCs and pixel data", () => {
    const fb = new Framebuffer(3, 2);
    fb.set(1, 1, RED);
    const png = encodePng(fb);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer);
    let o = 8;
    let idat: Uint8Array | null = null;
    while (o < png.length) {
      const len = dv.getUint32(o);
      const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
      expect(dv.getUint32(o + 8 + len)).toBe(crc32(png.subarray(o + 4, o + 8 + len)));
      if (type === "IDAT") idat = png.subarray(o + 8, o + 8 + len);
      o += 12 + len;
    }
    const raw = inflateSync(idat!);
    // row 1: filter byte, then pixel (1,1) at offset 1 + 4
    expect([...raw.subarray(13 + 1 + 4, 13 + 1 + 8)]).toEqual([...RED]);
  });

  test("kitty: chunked ≤4096, first chunk carries keys, last has m=0", () => {
    const fb = renderBlob(0, { backdrop: true }).upscale(4);
    const seq = encodeKitty(fb, { id: 7, cols: 48, rows: 21, compress: false });
    const chunks = [...seq.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0][1]).toContain("a=T");
    expect(chunks[0][1]).toContain(`s=${fb.width}`);
    expect(chunks[0][1]).toContain("i=7");
    expect(chunks[0][1]).toContain("c=48");
    for (const c of chunks) expect(c[2].length).toBeLessThanOrEqual(KITTY_CHUNK);
    expect(chunks.slice(0, -1).every((c) => c[1].endsWith("m=1"))).toBe(true);
    expect(chunks.at(-1)![1]).toEndWith("m=0");
    const bytes = Buffer.from(chunks.map((c) => c[2]).join(""), "base64");
    expect(bytes.length).toBe(fb.width * fb.height * 4);
  });

  test("kitty compression round-trips", () => {
    const fb = renderBlob(0.5);
    const seq = encodeKitty(fb);
    expect(seq).toContain("o=z");
    const payload = [...seq.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map((m) => m[1]).join("");
    expect(new Uint8Array(inflateSync(Buffer.from(payload, "base64")))).toEqual(new Uint8Array(fb.data));
  });

  test("iTerm2 inline image wraps a PNG", () => {
    const seq = encodeIterm(new Framebuffer(2, 2), { cols: 10 });
    expect(seq).toStartWith("\x1b]1337;File=inline=1;");
    expect(seq).toContain("width=10");
    expect(seq).toEndWith("\x07");
  });
});

describe("tier detection", () => {
  test.each([
    [{ TERM: "xterm-kitty" }, "kitty"],
    [{ TERM_PROGRAM: "ghostty" }, "kitty"],
    [{ TERM_PROGRAM: "iTerm.app" }, "iterm"],
    [{ TERM_PROGRAM: "WezTerm" }, "iterm"],
    [{ COLORTERM: "truecolor" }, "halfblock"],
    [{ TERM: "xterm-kitty", TMUX: "/tmp/tmux" }, "halfblock"],
    [{ TERM: "dumb" }, "ascii"],
    [{ NO_COLOR: "", TERM: "xterm-kitty" }, "ascii"],
    [{ BUDDY_GFX: "kitty" }, "kitty"],
  ] as const)("%o → %s", (env, tier) => {
    expect(detectTier(env).tier).toBe(tier);
  });

  test("explicit override beats env, 'auto' does not", () => {
    expect(detectTier({ TERM: "xterm-kitty" }, "ascii").tier).toBe("ascii");
    expect(detectTier({ TERM: "xterm-kitty" }, "auto").tier).toBe("kitty");
  });

  test("color mode: truecolor only when advertised", () => {
    expect(detectTier({ COLORTERM: "24bit" }).color).toBe("truecolor");
    expect(detectTier({ TERM: "xterm-256color" }).color).toBe("256");
  });

  test("tmux passthrough doubles ESC", () => {
    expect(tmuxWrap("\x1b_Gx\x1b\\")).toBe("\x1bPtmux;\x1b\x1b_Gx\x1b\x1b\\\x1b\\");
  });
});

describe("HD blob", () => {
  const hash = (fb: Framebuffer) => Bun.hash(fb.data).toString(16);

  test("deterministic: same time + seed → same pixels", () => {
    const o = { rarity: "epic" as const, shiny: true, seed: 3, bounces: [1] };
    expect(hash(renderBlob(1.3, o))).toBe(hash(renderBlob(1.3, o)));
    expect(hash(renderBlob(1.3, o))).not.toBe(hash(renderBlob(1.3, { ...o, seed: 4 })));
  });

  test("frame size is constant across every pose", () => {
    for (const t of [0, 0.3, 1.05, 1.3, 1.7, 2.4]) {
      const fb = renderBlob(t, { bounces: [1] });
      expect([fb.width, fb.height]).toEqual([BLOB_W, BLOB_H]);
    }
  });

  test("breathing changes the silhouette", () => {
    const top = (fb: Framebuffer) => {
      for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) if (fb.get(x, y)[3]) return y;
      return -1;
    };
    // breath peaks at t = 2.6/4 (tall) and 3·2.6/4 (short)
    expect(top(renderBlob(0.65))).toBeLessThan(top(renderBlob(1.95)));
  });

  test("bounce: crouch → airborne → squash → rest", () => {
    const at = (u: number) => blobPose(5 + u, { bounces: [5] });
    expect(at(0.13).sy).toBeLessThan(0.9); // anticipation
    expect(at(0.46).lift).toBeGreaterThan(12); // apex
    expect(at(0.3).sy).toBeGreaterThan(at(0.13).sy); // stretched on the way up
    expect(at(0.73).sy).toBeLessThan(0.85); // landing squash
    expect(at(0.3).eye).toBe("happy");
    expect(at(0.3).mouth).toBe("open");
    expect(at(2).lift).toBe(0);
    expect(at(2).eye).not.toBe("happy");
  });

  test("blinks happen, briefly", () => {
    let closed = 0;
    const N = 3600;
    for (let i = 0; i < N; i++) if (blinkAt(i / 60, 9) !== "open") closed++;
    // ~one blink (0.18 s, sometimes doubled) per 3.6 s slot
    expect(closed / N).toBeGreaterThan(0.03);
    expect(closed / N).toBeLessThan(0.1);
  });

  test("transparent without a backdrop, opaque with one", () => {
    expect(renderBlob(0).get(0, 0)[3]).toBe(0);
    expect(renderBlob(0, { backdrop: true }).get(0, 0)[3]).toBe(255);
  });

  test("rarity and shiny change the pixels", () => {
    const base = hash(renderBlob(0.5));
    expect(hash(renderBlob(0.5, { rarity: "legendary" }))).not.toBe(base);
    expect(hash(renderBlob(0.5, { shiny: true }))).not.toBe(base);
  });
});
