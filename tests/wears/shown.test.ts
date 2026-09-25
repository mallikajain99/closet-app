import { describe, expect, it } from "vitest";

import { itemsToShow } from "@/lib/wears/shown";

const item = (id: string) => ({ id });
const [top, jeans, shoes, coat] = [item("top"), item("jeans"), item("shoes"), item("coat")];

describe("itemsToShow", () => {
  it("shows the outfit as it stands when the wear matches what it was pinned to", () => {
    // Adding shoes to an outfit used to leave every day already logged showing the
    // old shoeless version, while the cell linked to an outfit that plainly had them.
    expect(
      itemsToShow({
        items: [top, jeans],
        pinnedItems: [top, jeans],
        currentItems: [top, jeans, shoes],
      }),
    ).toEqual([top, jeans, shoes]);
  });

  it("shows what was actually worn when the day was customised", () => {
    // A coat thrown over the outfit is the whole point of recording the difference;
    // falling back to the outfit's definition would silently drop it.
    expect(
      itemsToShow({
        items: [top, jeans, coat],
        pinnedItems: [top, jeans],
        currentItems: [top, jeans],
      }),
    ).toEqual([top, jeans, coat]);
  });

  it("keeps a customised day customised even after the outfit is edited", () => {
    // Both things happened: she wore it with a coat, and later added shoes to the
    // outfit. The day she actually had is the one with the coat and no shoes.
    expect(
      itemsToShow({
        items: [top, jeans, coat],
        pinnedItems: [top, jeans],
        currentItems: [top, jeans, shoes],
      }),
    ).toEqual([top, jeans, coat]);
  });

  it("treats leaving a piece out as a customisation too", () => {
    expect(
      itemsToShow({
        items: [top],
        pinnedItems: [top, jeans],
        currentItems: [top, jeans],
      }),
    ).toEqual([top]);
  });

  it("ignores ordering when deciding whether a day was customised", () => {
    expect(
      itemsToShow({
        items: [jeans, top],
        pinnedItems: [top, jeans],
        currentItems: [top, jeans, shoes],
      }),
    ).toEqual([top, jeans, shoes]);
  });

  it("falls back to what was logged for loose items", () => {
    expect(
      itemsToShow({ items: [top, jeans], pinnedItems: null, currentItems: null }),
    ).toEqual([top, jeans]);
  });

  it("falls back to what was logged when the outfit has no current version", () => {
    expect(
      itemsToShow({ items: [top, jeans], pinnedItems: [top, jeans], currentItems: null }),
    ).toEqual([top, jeans]);
  });
});
