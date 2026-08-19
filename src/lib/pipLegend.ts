import { t } from "./i18n";

/** Status pip colours on the review screen (right-hand column). */
export type PipLegendItem = {
  tone: string;
  label: string;
  meaning: string;
};

export function reviewPipLegend(): PipLegendItem[] {
  return [
    {
      tone: "attention",
      label: t("pip.attention"),
      meaning: t("pip.attentionMeaning")
    },
    {
      tone: "noteConfirm",
      label: t("pip.noteConfirm"),
      meaning: t("pip.noteConfirmMeaning")
    },
    {
      tone: "manual",
      label: t("pip.manual"),
      meaning: t("pip.manualMeaning")
    },
    {
      tone: "review",
      label: t("pip.review"),
      meaning: t("pip.reviewMeaning")
    },
    {
      tone: "library",
      label: t("pip.library"),
      meaning: t("pip.libraryMeaning")
    },
    {
      tone: "ai",
      label: t("pip.ai"),
      meaning: t("pip.aiMeaning")
    },
    {
      tone: "error",
      label: t("pip.error"),
      meaning: t("pip.errorMeaning")
    },
    {
      tone: "empty",
      label: t("pip.empty"),
      meaning: t("pip.emptyMeaning")
    }
  ];
}
