import { useT } from "../lib/i18n";
import type { PropertyEpcSummary, ReportMetadata } from "../types";
import PropertyAddressForm from "./PropertyAddressForm";
import PropertyEpcPanel from "./PropertyEpcPanel";

type Phase = "address" | "epc";

type Props = {
  phase: Phase;
  metadata: ReportMetadata;
  onMetadata: (next: ReportMetadata) => void;
  epc: PropertyEpcSummary | null;
  epcLoading: boolean;
  epcError: string | null;
  onPickedEpc: (epc: PropertyEpcSummary | null) => void;
  onRefreshEpc: () => void;
  onContinueFromAddress: () => void;
  onSkipToPhotos: () => void;
  onContinueFromEpc: () => void;
};

export default function FieldNotesGate({
  phase,
  metadata,
  onMetadata,
  epc,
  epcLoading,
  epcError,
  onPickedEpc,
  onRefreshEpc,
  onContinueFromAddress,
  onSkipToPhotos,
  onContinueFromEpc
}: Props) {
  const t = useT();

  if (phase === "address") {
    return (
      <div className="details field-notes-setup">
        <section className="panel">
          <h2>{t("address.title")}</h2>
          <PropertyAddressForm
            intro
            metadata={metadata}
            onMetadata={onMetadata}
            onPickedEpc={onPickedEpc}
          />
        </section>
        <div className="bottom-bar field-notes-setup-bar">
          <button type="button" className="btn" onClick={onSkipToPhotos}>
            {t("address.skipPhotos")}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={onContinueFromAddress}
          >
            {t("address.continueEpc")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="details field-notes-setup">
      <PropertyEpcPanel
        epc={epc}
        loading={epcLoading}
        error={epcError}
        onRefresh={onRefreshEpc}
      />
      <div className="bottom-bar field-notes-setup-bar">
        <button type="button" className="btn" onClick={onSkipToPhotos}>
          {t("address.skipPhotos")}
        </button>
        <button type="button" className="btn primary" onClick={onContinueFromEpc}>
          {t("epc.continueNotes")}
        </button>
      </div>
    </div>
  );
}
