/** Status pip colours on the review screen (right-hand column). */
export const REVIEW_PIP_LEGEND: Array<{
  tone: string;
  label: string;
  meaning: string;
}> = [
  {
    tone: "attention",
    label: "Orange",
    meaning: "Needs attention — empty, missing readings, or no confident match"
  },
  {
    tone: "noteConfirm",
    label: "Yellow / blue stripes",
    meaning:
      "Long field note — kept as written. Review this section to confirm accuracy and the pip will become blue"
  },
  {
    tone: "manual",
    label: "Blue",
    meaning: "Your wording — confirmed field note, edited text, or a cross-reference"
  },
  {
    tone: "review",
    label: "Yellow / green stripes",
    meaning:
      "Standard text is filled in but confidence is low. Review this section to confirm accuracy and the pip will become green"
  },
  {
    tone: "library",
    label: "Green",
    meaning:
      "Standard wording — confident library match, or a soft match you've already reviewed"
  },
  {
    tone: "ai",
    label: "Purple",
    meaning:
      "AI written — wording generated using ask AI feature based on picture and notes"
  },
  {
    tone: "error",
    label: "Red",
    meaning:
      "AI error — Ask AI failed on this section; open the card overlay to read the message, dismiss it, or try again"
  },
  {
    tone: "empty",
    label: "Grey",
    meaning: "Empty — no text yet and not otherwise flagged"
  }
];
