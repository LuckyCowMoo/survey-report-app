import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { AiProvider } from "../lib/aiProviders";
import {
  GUIDE_SLIDER_PROVIDERS,
  PROVIDER_BRANDS,
  PROVIDER_GUIDE,
  guideNotchCount,
  guideProviderAtNotch,
  type ProviderGuideEntry
} from "../lib/aiProviderGuide";
import { canCallOpenAiFromBrowser } from "../lib/openaiBrowserCompat";

import claudeLogo from "../assets/provider-logos/claude.svg?raw";
import geminiLogoUrl from "../assets/provider-logos/gemini.svg";
import openaiLogo from "../assets/provider-logos/openai.svg?raw";
import xaiLogo from "../assets/provider-logos/xai.svg?raw";
import llamaLogo from "../assets/provider-logos/llama.svg?raw";
import openrouterLogoUrl from "../assets/provider-logos/openrouter.svg";
import deepseekLogoUrl from "../assets/provider-logos/deepseek.svg";
import mistralLogoUrl from "../assets/provider-logos/mistral.svg";
import togetherLogoUrl from "../assets/provider-logos/together.svg";
import fireworksLogoUrl from "../assets/provider-logos/fireworks.svg";
import sparklesLogoUrl from "../assets/provider-logos/sparkles.svg";

/** Space from track edge to first/last pip centre — past an expanded pip. */
const TRACK_PIP_INSET_PX = 24;

const OVERVIEW_BRAND = {
  accent: "#ff8a65",
  panel: "#2a211c",
  ink: "#f6efe9",
  muted: "rgba(246, 239, 233, 0.72)"
} as const;

type LogoKind =
  | { type: "mono"; svg: string }
  | { type: "color"; src: string };

const PROVIDER_LOGOS: Record<AiProvider, LogoKind> = {
  claude: { type: "mono", svg: claudeLogo },
  gemini: { type: "color", src: geminiLogoUrl },
  openai: { type: "mono", svg: openaiLogo },
  xai: { type: "mono", svg: xaiLogo },
  groq: { type: "mono", svg: llamaLogo },
  openrouter: { type: "color", src: openrouterLogoUrl },
  deepseek: { type: "color", src: deepseekLogoUrl },
  mistral: { type: "color", src: mistralLogoUrl },
  together: { type: "color", src: togetherLogoUrl },
  fireworks: { type: "color", src: fireworksLogoUrl }
};

function sizeLogoSvg(svg: string, px = 40): string {
  return svg
    .replace(/\swidth="1em"/g, ` width="${px}"`)
    .replace(/\sheight="1em"/g, ` height="${px}"`)
    .replace(/\swidth="40"/g, ` width="${px}"`)
    .replace(/\sheight="40"/g, ` height="${px}"`)
    .replace(/<title>[^<]*<\/title>/, "");
}

/** Official brand marks (via @lobehub/icons-static-svg; Claude starburst SVG). */
function ProviderMark({ provider }: { provider: AiProvider }) {
  const logo = PROVIDER_LOGOS[provider];
  const title = PROVIDER_GUIDE[provider].brand.company;
  if (logo.type === "mono") {
    return (
      <span
        className={`provider-key-logo-svg${provider === "claude" ? " is-claude-star" : ""}`}
        role="img"
        aria-label={title}
        dangerouslySetInnerHTML={{ __html: sizeLogoSvg(logo.svg) }}
      />
    );
  }
  return (
    <img
      className="provider-key-logo-img"
      src={logo.src}
      alt=""
      aria-hidden
      width={40}
      height={40}
      draggable={false}
    />
  );
}

/** Small logo for a slider pip — grayscale until selected. */
function PipMark({
  provider,
  active
}: {
  provider: AiProvider;
  active: boolean;
}) {
  const logo = PROVIDER_LOGOS[provider];
  // xAI’s mark is near-white — use black on the light pip so it stays visible.
  const accent =
    provider === "xai" ? "#111111" : PROVIDER_BRANDS[provider].accent;
  if (logo.type === "mono") {
    return (
      <span
        className={`provider-key-pip-mark${active ? " is-active" : ""}`}
        style={{ color: active ? accent : undefined }}
        aria-hidden
        dangerouslySetInnerHTML={{ __html: sizeLogoSvg(logo.svg, 18) }}
      />
    );
  }
  return (
    <img
      className={`provider-key-pip-mark${active ? " is-active" : ""}`}
      src={logo.src}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

function SetupSteps({ entry }: { entry: ProviderGuideEntry }) {
  return (
    <ol className="guide-steps provider-key-steps">
      {entry.steps.map((step, i) => (
        <li key={i}>
          {step.href && step.linkLabel ? (
            <>
              {step.text}
              <a href={step.href} target="_blank" rel="noopener noreferrer">
                {step.linkLabel}
              </a>
              {step.afterLink ?? ""}
            </>
          ) : (
            step.text
          )}
        </li>
      ))}
    </ol>
  );
}

function ProviderKeyInstallField({
  provider,
  value,
  onChange
}: {
  provider: AiProvider;
  value: string;
  onChange: (value: string, provider: AiProvider) => void;
}) {
  const [visible, setVisible] = useState(false);
  const name = PROVIDER_GUIDE[provider].brand.keyService;
  const prefix = PROVIDER_GUIDE[provider].keyPrefix;

  return (
    <div className="provider-key-install">
      <label className="provider-key-install-label" htmlFor={`pk-key-${provider}`}>
        Paste your {name} API key
      </label>
      <div className="secret-input">
        <input
          id={`pk-key-${provider}`}
          type={visible ? "text" : "password"}
          value={value}
          placeholder={prefix.includes("no fixed") ? "Paste key here" : prefix}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value, provider)}
        />
        <button
          type="button"
          className="btn small secret-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide API key" : "Show API key"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

interface ProviderKeyGuideProps {
  /** Per-provider keys — only the selected provider’s key is shown. */
  apiKeys: Partial<Record<AiProvider, string>>;
  onApiKeyChange: (apiKey: string, provider: AiProvider) => void;
}

export default function ProviderKeyGuide({
  apiKeys,
  onApiKeyChange
}: ProviderKeyGuideProps) {
  const notchCount = guideNotchCount();
  const maxNotch = notchCount - 1;
  const [notch, setNotch] = useState(0);
  const [dragValue, setDragValue] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [openAiBrowserOk, setOpenAiBrowserOk] = useState<boolean | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const provider = guideProviderAtNotch(notch);
  const entry = provider ? PROVIDER_GUIDE[provider] : null;
  const visual = (isDragging ? dragValue : notch) / maxNotch;

  useEffect(() => {
    if (provider !== "openai") {
      setOpenAiBrowserOk(null);
      return;
    }
    let cancelled = false;
    setOpenAiBrowserOk(null);
    void canCallOpenAiFromBrowser().then((ok) => {
      if (!cancelled) setOpenAiBrowserOk(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const snapTo = useCallback(
    (raw: number) => {
      const clamped = Math.max(0, Math.min(maxNotch, Math.round(raw)));
      setNotch(clamped);
      setDragValue(clamped);
    },
    [maxNotch]
  );

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const usable = Math.max(1, rect.width - TRACK_PIP_INSET_PX * 2);
      const t = (clientX - rect.left - TRACK_PIP_INSET_PX) / usable;
      return Math.max(0, Math.min(maxNotch, t * maxNotch));
    },
    [maxNotch]
  );

  const endDrag = useCallback(
    (clientX: number) => {
      setIsDragging(false);
      snapTo(valueFromClientX(clientX));
    },
    [snapTo, valueFromClientX]
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      setDragValue(valueFromClientX(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      endDrag(e.clientX);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, endDrag, valueFromClientX]);

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setDragValue(valueFromClientX(e.clientX));
  };

  const brandStyle = entry
    ? ({
        ["--pk-accent"]: entry.brand.accent,
        ["--pk-panel"]: entry.brand.panel,
        ["--pk-ink"]: entry.brand.ink,
        ["--pk-muted"]: entry.brand.muted
      } as CSSProperties)
    : ({
        ["--pk-accent"]: OVERVIEW_BRAND.accent,
        ["--pk-panel"]: OVERVIEW_BRAND.panel,
        ["--pk-ink"]: OVERVIEW_BRAND.ink,
        ["--pk-muted"]: OVERVIEW_BRAND.muted
      } as CSSProperties);

  return (
    <div className="provider-key-guide is-branded" style={brandStyle}>
      <p id={labelId} className="provider-key-slider-label">
        Slide to a provider for key setup
      </p>

      <div className="provider-key-slider">
        <div
          ref={trackRef}
          className="provider-key-track"
          onPointerDown={onTrackPointerDown}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={maxNotch}
          aria-valuenow={notch}
          aria-valuetext={
            provider ? PROVIDER_GUIDE[provider].brand.shortName : "Overview"
          }
          aria-labelledby={labelId}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              snapTo(notch + 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              snapTo(notch - 1);
            } else if (e.key === "Home") {
              e.preventDefault();
              snapTo(0);
            } else if (e.key === "End") {
              e.preventDefault();
              snapTo(maxNotch);
            }
          }}
        >
          <div
            className={`provider-key-track-fill${isDragging ? " is-dragging" : ""}`}
            style={{
              // Ends past the active pip; at the last notch this reaches the track end.
              width: `calc(${TRACK_PIP_INSET_PX * 2}px + (100% - ${TRACK_PIP_INSET_PX * 2}px) * ${visual})`
            }}
          />
          <div className="provider-key-notches">
            {Array.from({ length: notchCount }, (_, i) => {
              const active = i === notch && !isDragging;
              const pipProvider =
                i === 0 ? null : GUIDE_SLIDER_PROVIDERS[i - 1];
              const t = i / maxNotch;
              return (
                <button
                  key={i}
                  type="button"
                  className={`provider-key-notch${active ? " is-active" : ""}${i === 0 ? " is-home" : ""}`}
                  style={{
                    left: `calc(${TRACK_PIP_INSET_PX}px + (100% - ${TRACK_PIP_INSET_PX * 2}px) * ${t})`
                  }}
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDragging(false);
                    snapTo(i);
                  }}
                  aria-label={
                    i === 0
                      ? "Overview"
                      : PROVIDER_GUIDE[pipProvider!].brand.shortName
                  }
                >
                  {pipProvider ? (
                    <PipMark provider={pipProvider} active={active} />
                  ) : (
                    <img
                      className={`provider-key-pip-mark provider-key-pip-sparkles${active ? " is-active" : ""}`}
                      src={sparklesLogoUrl}
                      alt=""
                      width={14}
                      height={14}
                      draggable={false}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!provider && (
        <div
          key="overview"
          className="provider-key-panel provider-key-panel-brand"
        >
          <div className="provider-key-hero">
            <div className="provider-key-logo-wrap">
              <img
                className="provider-key-logo-img provider-key-logo-sparkles"
                src={sparklesLogoUrl}
                alt=""
                aria-hidden
                width={40}
                height={40}
                draggable={false}
              />
            </div>
            <div className="provider-key-name-wrap">
              <p className="provider-key-company">Ask AI</p>
              <h4 className="provider-key-name">How keys work here</h4>
            </div>
          </div>
          <div className="provider-key-setup">
            <p className="provider-key-note" style={{ marginTop: 0 }}>
              Ask AI needs an external LLM API key. Keys stay on this device only
              and are never uploaded elsewhere by the app.
            </p>
            <ol className="guide-steps">
              <li>On the home screen, open Settings.</li>
              <li>
                Paste your API key into the <strong>AI API key</strong> field —
                the app detects the provider from the key prefix and loads
                matching models.
              </li>
              <li>
                If the key has no fixed prefix (or looks like OpenAI but is
                DeepSeek), tap the correct type under{" "}
                <strong>Supported API key types</strong>.
              </li>
              <li>
                Leave the model as the default unless you need another, then tap
                Done.
              </li>
            </ol>
            <p className="provider-key-note">
              Drag the slider onto a provider notch for step-by-step key
              instructions.
            </p>
          </div>
        </div>
      )}

      {provider && entry && (
        <div
          key={provider}
          className="provider-key-panel provider-key-panel-brand"
        >
          <div className="provider-key-hero">
            <div className="provider-key-logo-wrap">
              <ProviderMark provider={provider} />
            </div>
            <div className="provider-key-name-wrap">
              <p className="provider-key-company">{entry.brand.company}</p>
              <h4 className="provider-key-name">{entry.brand.shortName}</h4>
              <p className="provider-key-prefix">
                Keys like <code>{entry.keyPrefix}</code>
              </p>
            </div>
          </div>
          <div className="provider-key-setup">
            <h4 className="provider-key-setup-title">
              Get a {entry.brand.keyService} key
            </h4>
            <SetupSteps entry={entry} />
            {entry.note && <p className="provider-key-note">{entry.note}</p>}
            {provider === "openai" && openAiBrowserOk === false && (
              <p className="provider-key-warning" role="alert">
                <strong>This browser can’t use OpenAI from the app.</strong>{" "}
                OpenAI blocks the request (CORS), so Ask AI will fail with a
                network error. Use Claude, Gemini, or OpenRouter instead.
              </p>
            )}
            <ProviderKeyInstallField
              provider={provider}
              value={apiKeys[provider] ?? ""}
              onChange={onApiKeyChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
