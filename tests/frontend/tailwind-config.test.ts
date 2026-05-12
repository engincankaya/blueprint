import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("frontend Tailwind configuration", () => {
  it("resolves content globs relative to the frontend config file", () => {
    const config = require("../../frontend/tailwind.config.cjs");

    expect(config.content).toMatchObject({
      relative: true,
      files: expect.arrayContaining([
        "./index.html",
        "./src/**/*.{ts,tsx}",
      ]),
    });
  });
});
