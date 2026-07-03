import { afterEach, describe, expect, it } from "vitest";
import {
  clearAddonRegistrations,
  getDynamicRoutes,
  registerAddonNavItem,
  registerAddonRoute,
} from "./addons-runtime-context";

describe("addons runtime route policy", () => {
  afterEach(() => {
    clearAddonRegistrations("evil-addon");
    clearAddonRegistrations("swingfolio-addon");
  });

  it("allows routes under the add-on slug without the addon suffix", () => {
    registerAddonNavItem("swingfolio-addon", {
      id: "swingfolio",
      label: "Swingfolio",
      route: "/addons/swingfolio",
    });
    registerAddonRoute("swingfolio-addon", {
      path: "/addons/swingfolio/settings",
      routeId: "/addons/swingfolio/settings",
    });

    expect(getDynamicRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addonId: "swingfolio-addon",
          href: "/addons/swingfolio/settings",
        }),
      ]),
    );
  });

  it("blocks an add-on from self-authorizing another add-on namespace", () => {
    expect(() =>
      registerAddonNavItem("evil-addon", {
        id: "victim",
        label: "Victim",
        route: "/addon/victim-addon",
      }),
    ).toThrow("cannot register sidebar route");

    expect(() =>
      registerAddonRoute("evil-addon", {
        path: "/addon/victim-addon/dashboard",
        routeId: "/addon/victim-addon/dashboard",
      }),
    ).toThrow("cannot register route");
  });
});
