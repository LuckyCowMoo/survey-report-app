import { useId } from "react";
import type { TutorialLanguage } from "../lib/tutorial/progress";
import flagEngland from "../assets/tutorial/flag-england.svg";
import flagWales from "../assets/tutorial/flag-wales.svg";
import flagScotland from "../assets/tutorial/flag-scotland.svg";
import flagIreland from "../assets/tutorial/flag-ireland.svg";
import flagNi from "../assets/tutorial/flag-ni.svg";
import mapEngland from "../assets/tutorial/map-england.svg?raw";
import mapWales from "../assets/tutorial/map-wales.svg?raw";
import mapScotland from "../assets/tutorial/map-scotland.svg?raw";
import mapIreland from "../assets/tutorial/map-ireland.svg?raw";
import mapNi from "../assets/tutorial/map-ni.svg?raw";

type Props = {
  value: TutorialLanguage | null;
  onChange: (lang: TutorialLanguage) => void;
  /** Compact 4-across row for Settings. */
  layout?: "grid" | "row";
};

export default function CountryLanguageGrid({
  value,
  onChange,
  layout = "grid"
}: Props) {
  return (
    <div
      className={`tutorial-lang-grid${layout === "row" ? " is-row" : ""}`}
      role="listbox"
      aria-label="Language"
    >
      <LangCard
        label="English"
        selected={value === "en"}
        onSelect={() => onChange("en")}
      >
        <FlagShape svg={mapEngland} flag={flagEngland} label="England" />
      </LangCard>
      <LangCard
        label="Welsh"
        selected={value === "cy"}
        onSelect={() => onChange("cy")}
      >
        <FlagShape svg={mapWales} flag={flagWales} label="Wales" />
      </LangCard>
      <LangCard
        label="Irish"
        selected={value === "ga"}
        onSelect={() => onChange("ga")}
      >
        <div className="tutorial-island-map" aria-hidden>
          <FlagShape svg={mapIreland} flag={flagIreland} label="Ireland" />
          <FlagShape svg={mapNi} flag={flagNi} label="Northern Ireland" />
        </div>
      </LangCard>
      <LangCard
        label="Scottish"
        selected={value === "gd"}
        onSelect={() => onChange("gd")}
      >
        <FlagShape svg={mapScotland} flag={flagScotland} label="Scotland" />
      </LangCard>
    </div>
  );
}

function LangCard({
  label,
  selected,
  onSelect,
  children
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`tutorial-lang-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="tutorial-lang-map">{children}</span>
      <span className="tutorial-lang-label">{label}</span>
    </button>
  );
}

function svgAttr(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`${name}="([^"]+)"`));
  return match?.[1] ?? null;
}

function FlagShape({
  svg,
  flag,
  label
}: {
  svg: string;
  flag: string;
  label: string;
}) {
  const uid = useId().replace(/:/g, "");
  const viewBox = svgAttr(svg, "viewBox") ?? "0 0 120 120";
  const d = svgAttr(svg, "d");
  const transform = svgAttr(svg, "transform");
  const patternId = `${uid}-flag`;

  if (!d) return null;

  return (
    <span className="tutorial-country-flag-wrap">
      <svg
        className="tutorial-country-svg"
        viewBox={viewBox}
        role="img"
        aria-label={label}
      >
        <defs>
          <pattern
            id={patternId}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width={1}
            height={1}
          >
            <image
              href={flag}
              x={0}
              y={0}
              width={1}
              height={1}
              preserveAspectRatio="xMidYMid slice"
            />
          </pattern>
        </defs>
        <path
          d={d}
          transform={transform ?? undefined}
          fill={`url(#${patternId})`}
          stroke="currentColor"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
