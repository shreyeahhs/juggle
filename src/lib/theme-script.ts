/**
 * Applies the saved theme before first paint, so there is no flash of the wrong
 * one. It has to be a blocking inline script: `next/script` with
 * `beforeInteractive` is delivered through the RSC payload and runs after
 * hydration begins, which is the flash this exists to avoid.
 *
 * Defined here rather than inline because two documents need it. The root layout
 * is the usual one; `global-error` replaces the root layout entirely, so without
 * its own copy any uncaught error would render in the light theme regardless of
 * what the visitor chose.
 */
export const THEME_STORAGE_KEY = "juggle-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
