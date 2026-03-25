import { describe, it, expect } from "vitest";

import { parseTemporalMap } from "../parser";
import { SIMPLE_TEXT_SOURCE } from "@/samples/simple-text";
import { MULTI_SEQUENCE_SOURCE } from "@/samples/multi-sequence";
import { SPRING_ANIMATION_SOURCE } from "@/samples/spring-animation";
import { NESTED_COMPONENTS_SOURCE } from "@/samples/nested-components";
import { COMPLEX_TIMELINE_SOURCE } from "@/samples/complex-timeline";

describe("parseTemporalMap", () => {
  // --------------------------------------------------------------------------
  // simple-text
  // --------------------------------------------------------------------------
  describe("simple-text", () => {
    it("has at least 1 node", () => {
      const map = parseTemporalMap(SIMPLE_TEXT_SOURCE);
      expect(Array.from(map.nodes.values()).length).toBeGreaterThanOrEqual(1);
    });

    it("has at least 1 interpolate animation with frameRange[1] === 150", () => {
      const map = parseTemporalMap(SIMPLE_TEXT_SOURCE);
      const allAnimations = Array.from(map.nodes.values()).flatMap(
        (n) => n.animations
      );
      const interpolateAnims = allAnimations.filter(
        (a) => a.type === "interpolate"
      );
      expect(interpolateAnims.length).toBeGreaterThanOrEqual(1);
      const has150 = interpolateAnims.some((a) => a.frameRange[1] === 150);
      expect(has150).toBe(true);
    });

    it("has no activeFrameRange on any node (all null, no Sequence)", () => {
      const map = parseTemporalMap(SIMPLE_TEXT_SOURCE);
      const allNull = Array.from(map.nodes.values()).every(
        (n) => n.activeFrameRange === null
      );
      expect(allNull).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // multi-sequence
  // --------------------------------------------------------------------------
  describe("multi-sequence", () => {
    it("has exactly 3 TitleCard nodes with activeFrameRange [0,90], [90,180], [180,270]", () => {
      const map = parseTemporalMap(MULTI_SEQUENCE_SOURCE);
      const titleCards = Array.from(map.nodes.values()).filter(
        (n) => n.componentName === "TitleCard"
      );
      expect(titleCards).toHaveLength(3);

      const sorted = [...titleCards].sort(
        (a, b) => (a.activeFrameRange?.[0] ?? 0) - (b.activeFrameRange?.[0] ?? 0)
      );
      expect(sorted[0].activeFrameRange).toEqual([0, 90]);
      expect(sorted[1].activeFrameRange).toEqual([90, 180]);
      expect(sorted[2].activeFrameRange).toEqual([180, 270]);
    });
  });

  // --------------------------------------------------------------------------
  // spring-animation
  // --------------------------------------------------------------------------
  describe("spring-animation", () => {
    it("has at least 1 spring animation with damping 14, stiffness 120, mass 1", () => {
      const map = parseTemporalMap(SPRING_ANIMATION_SOURCE);
      const allAnimations = Array.from(map.nodes.values()).flatMap(
        (n) => n.animations
      );
      const springAnims = allAnimations.filter((a) => a.type === "spring");
      expect(springAnims.length).toBeGreaterThanOrEqual(1);

      const matching = springAnims.find(
        (a) =>
          a.springConfig?.damping === 14 &&
          a.springConfig?.stiffness === 120 &&
          a.springConfig?.mass === 1
      );
      expect(matching).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // nested-components
  // --------------------------------------------------------------------------
  describe("nested-components", () => {
    it("Badge nodes have activeFrameRange [0,180], [30,180], [60,180]", () => {
      const map = parseTemporalMap(NESTED_COMPONENTS_SOURCE);
      const badgeNodes = Array.from(map.nodes.values()).filter(
        (n) => n.componentName === "Badge"
      );
      expect(badgeNodes).toHaveLength(3);

      const sorted = [...badgeNodes].sort(
        (a, b) => (a.activeFrameRange?.[0] ?? 0) - (b.activeFrameRange?.[0] ?? 0)
      );
      expect(sorted[0].activeFrameRange).toEqual([0, 180]);
      expect(sorted[1].activeFrameRange).toEqual([30, 180]);
      expect(sorted[2].activeFrameRange).toEqual([60, 180]);
    });
  });

  // --------------------------------------------------------------------------
  // complex-timeline
  // --------------------------------------------------------------------------
  describe("complex-timeline", () => {
    it("has a node with activeFrameRange [0, 250]", () => {
      const map = parseTemporalMap(COMPLEX_TIMELINE_SOURCE);
      const nodes = Array.from(map.nodes.values());
      const has0to250 = nodes.some(
        (n) => n.activeFrameRange?.[0] === 0 && n.activeFrameRange?.[1] === 250
      );
      expect(has0to250).toBe(true);
    });

    it("has at least one node with activeFrameRange[0] === 60", () => {
      const map = parseTemporalMap(COMPLEX_TIMELINE_SOURCE);
      const nodes = Array.from(map.nodes.values());
      const hasSixtyStart = nodes.some((n) => n.activeFrameRange?.[0] === 60);
      expect(hasSixtyStart).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // edge cases
  // --------------------------------------------------------------------------
  describe("edge cases", () => {
    it("returns nodes.size === 0 for empty source", () => {
      const map = parseTemporalMap("");
      expect(map.nodes.size).toBe(0);
    });

    it("returns nodes.size === 0 and does not throw for syntax error", () => {
      expect(() => {
        const map = parseTemporalMap("const x = {{{");
        expect(map.nodes.size).toBe(0);
      }).not.toThrow();
    });

    it("returns nodes with empty animations arrays for source with no Remotion APIs", () => {
      const source = "const Foo = () => <div><span>hello</span></div>;";
      const map = parseTemporalMap(source);
      const nodes = Array.from(map.nodes.values());
      const allEmpty = nodes.every((n) => n.animations.length === 0);
      expect(allEmpty).toBe(true);
    });
  });
});
