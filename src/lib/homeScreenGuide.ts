export interface HomeScreenStep {
  text: string;
}

export type HomeScreenGuideId =
  | "overview"
  | "ios-safari"
  | "android-chrome"
  | "desktop-chromium"
  | "firefox"
  | "desktop-safari";

export interface HomeScreenGuideEntry {
  id: HomeScreenGuideId;
  shortName: string;
  title: string;
  subtitle: string;
  /** Brand mark in the panel hero / active pip. */
  logo: "home" | "android" | "chrome" | "firefox" | "safari" | "edge";
  accent: string;
  /** Always-dark branded panel (readable in light and dark app themes). */
  panel: string;
  ink: string;
  muted: string;
  steps: HomeScreenStep[];
  note?: string;
}

/** Slider notches: overview first, then common OS / browser paths. */
export const HOME_SCREEN_GUIDE: HomeScreenGuideEntry[] = [
  {
    id: "overview",
    shortName: "Overview",
    title: "Add to Home Screen",
    subtitle: "Install this page like an app",
    logo: "home",
    accent: "#ff8a65",
    panel: "#2a211c",
    ink: "#f6efe9",
    muted: "rgba(246, 239, 233, 0.72)",
    steps: [
      {
        text: "Open this site in your usual browser, then add it to the home screen so it opens full-screen with its own icon."
      },
      {
        text: "After the first visit it can load offline for reviewing and editing; Ask AI still needs an internet connection."
      },
      {
        text: "Slide to your device for step-by-step instructions — the matching tab is selected automatically when we can detect your browser."
      }
    ]
  },
  {
    id: "ios-safari",
    shortName: "iOS",
    title: "iPhone / iPad (Safari)",
    subtitle: "Add to Home Screen",
    logo: "safari",
    accent: "#0a84ff",
    panel: "#121826",
    ink: "#eef3ff",
    muted: "rgba(238, 243, 255, 0.72)",
    steps: [
      { text: "Open this site in Safari (not Chrome or in-app browsers)." },
      { text: "Tap the Share button (square with an arrow pointing up)." },
      { text: "Scroll the sheet and tap Add to Home Screen." },
      { text: "Confirm the name, then tap Add." }
    ],
    note: "Only Safari on iOS can add a proper home-screen web app."
  },
  {
    id: "android-chrome",
    shortName: "Android",
    title: "Android (Chrome)",
    subtitle: "Install or Add to Home screen",
    logo: "android",
    accent: "#3ddc84",
    panel: "#102018",
    ink: "#e8fff2",
    muted: "rgba(232, 255, 242, 0.72)",
    steps: [
      { text: "Open this site in Chrome." },
      { text: "Tap the ⋮ menu (top right)." },
      {
        text: "Tap Install app or Add to Home screen (wording varies by Chrome version)."
      },
      { text: "Confirm Install / Add." }
    ],
    note: "If you don’t see Install, use Add to Home screen — both put an icon on the launcher. On Firefox for Android, open the menu → Install."
  },
  {
    id: "desktop-chromium",
    shortName: "Chrome",
    title: "Windows / Mac (Chrome or Edge)",
    subtitle: "Install as an app",
    logo: "chrome",
    accent: "#4285f4",
    panel: "#152033",
    ink: "#eef3ff",
    muted: "rgba(238, 243, 255, 0.72)",
    steps: [
      { text: "Open this site in Chrome or Microsoft Edge." },
      {
        text: "Click the install icon in the address bar (monitor with ↓), or open the browser menu → Install / Apps."
      },
      { text: "Confirm Install. The app opens in its own window." }
    ]
  },
  {
    id: "firefox",
    shortName: "Firefox",
    title: "Firefox",
    subtitle: "Desktop or Android",
    logo: "firefox",
    accent: "#ff7139",
    panel: "#2a1810",
    ink: "#fff1e8",
    muted: "rgba(255, 241, 232, 0.72)",
    steps: [
      {
        text: "Desktop: open the site in Firefox, then use the address-bar install icon if shown, or Menu → More tools → Install site as app / Save page to…"
      },
      {
        text: "Android: open the ⋮ menu and tap Install (or Add to Home screen)."
      },
      {
        text: "Confirm. On desktop the site opens in an app window; on Android it appears on the launcher."
      }
    ],
    note: "Firefox’s install wording varies by version — look for Install or Add to Home screen."
  },
  {
    id: "desktop-safari",
    shortName: "Safari",
    title: "Mac (Safari)",
    subtitle: "Add to Dock",
    logo: "safari",
    accent: "#0a84ff",
    panel: "#121826",
    ink: "#eef3ff",
    muted: "rgba(238, 243, 255, 0.72)",
    steps: [
      { text: "Open this site in Safari." },
      { text: "File → Add to Dock… (or Share → Add to Dock on newer macOS)." },
      { text: "Confirm the name. The site opens from the Dock like an app." }
    ],
    note: "On older Safari builds, use File → Add to Dock if the Share path is missing."
  }
];

export function homeScreenGuideAtNotch(notch: number): HomeScreenGuideEntry {
  const i = Math.max(0, Math.min(HOME_SCREEN_GUIDE.length - 1, notch));
  return HOME_SCREEN_GUIDE[i]!;
}

export function homeScreenNotchCount(): number {
  return HOME_SCREEN_GUIDE.length;
}

export function homeScreenNotchForId(id: HomeScreenGuideId): number {
  const i = HOME_SCREEN_GUIDE.findIndex((e) => e.id === id);
  return i >= 0 ? i : 0;
}

/** Best-matching install guide for the current browser / OS. */
export function detectHomeScreenGuideId(): HomeScreenGuideId {
  if (typeof navigator === "undefined") return "overview";
  const ua = navigator.userAgent;
  const touchMac =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || touchMac;
  const isAndroid = /Android/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isEdge = /Edg\//i.test(ua);
  const isChromium =
    /Chrome|CriOS|Chromium/i.test(ua) &&
    !isEdge &&
    !/OPR|Opera|Edg\//i.test(ua);
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome|CriOS|Chromium|Firefox|FxiOS|Edg\/|OPR|Opera/i.test(ua);

  if (isIOS) return "ios-safari";
  if (isAndroid && isFirefox) return "firefox";
  if (isAndroid) return "android-chrome";
  if (isFirefox) return "firefox";
  if (isSafari) return "desktop-safari";
  if (isChromium || isEdge) return "desktop-chromium";
  return "overview";
}

export function detectHomeScreenNotch(): number {
  return homeScreenNotchForId(detectHomeScreenGuideId());
}
