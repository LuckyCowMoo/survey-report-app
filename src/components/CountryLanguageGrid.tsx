import type { TutorialLanguage } from "../lib/tutorial/progress";
import flagEngland from "../assets/tutorial/flag-england.svg";
import flagWales from "../assets/tutorial/flag-wales.svg";
import flagScotland from "../assets/tutorial/flag-scotland.svg";
import flagIreland from "../assets/tutorial/flag-ireland.svg";
import flagNi from "../assets/tutorial/flag-ni.svg";
import mapEngland from "../assets/tutorial/map-england.svg";
import mapWales from "../assets/tutorial/map-wales.svg";
import mapScotland from "../assets/tutorial/map-scotland.svg";
import mapIreland from "../assets/tutorial/map-ireland.svg";
import mapNi from "../assets/tutorial/map-ni.svg";

type Props = {
  value: TutorialLanguage | null;
  onChange: (lang: TutorialLanguage) => void;
};

export default function CountryLanguageGrid({ value, onChange }: Props) {
  return (
    <div className="tutorial-lang-grid" role="listbox" aria-label="Language">
      <LangCard
        label="English"
        selected={value === "en"}
        onSelect={() => onChange("en")}
      >
        <FlagShape flag={flagEngland} outline={mapEngland} label="England" />
      </LangCard>
      <LangCard
        label="Welsh"
        selected={value === "cy"}
        onSelect={() => onChange("cy")}
      >
        <FlagShape flag={flagWales} outline={mapWales} label="Wales" />
      </LangCard>
      <LangCard
        label="Irish"
        selected={value === "ga"}
        onSelect={() => onChange("ga")}
      >
        <div className="tutorial-island-map" aria-hidden>
          <FlagShape flag={flagIreland} outline={mapIreland} label="Ireland" />
          <FlagShape flag={flagNi} outline={mapNi} label="Northern Ireland" />
        </div>
      </LangCard>
      <LangCard
        label="Scottish"
        selected={value === "gd"}
        onSelect={() => onChange("gd")}
      >
        <FlagShape flag={flagScotland} outline={mapScotland} label="Scotland" />
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

function FlagShape({
  flag,
  outline,
  label
}: {
  flag: string;
  outline: string;
  label: string;
}) {
  return (
    <span
      className="tutorial-country-flag"
      role="img"
      aria-label={label}
      style={{
        backgroundImage: `url(${flag})`,
        WebkitMaskImage: `url(${outline})`,
        maskImage: `url(${outline})`
      }}
    />
  );
}
