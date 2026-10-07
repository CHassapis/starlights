import { describe, expect, it } from "vitest";
import { dragFrame, formatFrame, parseFrame, placePicture, WHOLE_PICTURE } from "./portrait-frame";

const box = { w: 100, h: 100 };
const tall = { w: 500, h: 1000 };

describe("the portrait's place on the sheet", () => {
  it("fits the whole picture by default, centred", () => {
    expect(placePicture(tall, box, WHOLE_PICTURE)).toMatchObject({ w: 50, h: 100, left: 25, top: 0, slackX: 0, slackY: 0 });
  });

  it("zooms in and shows the part chosen", () => {
    const centre = placePicture(tall, box, { size: 2, x: 0, y: 0 });
    expect(centre).toMatchObject({ w: 100, h: 200, left: 0, top: -50 });
    expect(placePicture(tall, box, { size: 2, x: 0, y: -1 }).top).toBe(0); // the top of the picture
    expect(placePicture(tall, box, { size: 2, x: 0, y: 1 }).top).toBe(-100); // the bottom
  });

  it("moves with the pointer, never past the picture's edges", () => {
    const f = dragFrame({ size: 2, x: 0, y: 0 }, tall, box, 0, 25);
    expect(f.y).toBe(-0.5); // dragged down: more of the top shows
    expect(placePicture(tall, box, f).top).toBe(-25);
    expect(dragFrame({ size: 2, x: 0, y: 0 }, tall, box, 0, 999).y).toBe(-1);
    expect(dragFrame(WHOLE_PICTURE, tall, box, 30, 30)).toEqual(WHOLE_PICTURE);
  });

  it("is kept as text, checked when read back", () => {
    expect(parseFrame(formatFrame({ size: 1.6, x: 0.2, y: -0.5 }))).toEqual({ size: 1.6, x: 0.2, y: -0.5 });
    expect(parseFrame("9,5,-5")).toEqual({ size: 4, x: 1, y: -1 });
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("big")).toBeNull();
  });
});
