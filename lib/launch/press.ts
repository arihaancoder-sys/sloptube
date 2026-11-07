// The screenshots /press shows. scripts/press-kit.mjs copies them from shots/
// into public/press/ as WebP. No imports, so Node loads it directly.

export type PressShot = { name: string; from: string; alt: string; width: number; height: number };

export const PRESS_SHOTS: PressShot[] = [
  { name: "home-light", from: "feed/home-1280-light.png", alt: "The home feed in the light theme", width: 1280, height: 800 },
  { name: "home-dark", from: "feed/home-1280-dark.png", alt: "The home feed in the dark theme", width: 1280, height: 800 },
  { name: "watch-light", from: "watch/watch-1280-light.png", alt: "The watch page with the player and Up next", width: 1280, height: 800 },
  { name: "shorts-dark", from: "shorts/shorts-1280-dark.png", alt: "Snips, one vertical video at a time", width: 1280, height: 800 },
  { name: "studio-light", from: "studio/content-1280-light.png", alt: "The creator studio's Content page", width: 1280, height: 900 },
  { name: "phone-home", from: "feed/home-390-light.png", alt: "The home feed on a phone", width: 390, height: 844 },
];
