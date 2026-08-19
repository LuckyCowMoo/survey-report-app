import { t } from "../i18n";

export type TutorialBeat =
  | "welcome"
  | "language"
  | "theme"
  | "surveyorName"
  | "pitch"
  | "newReport"
  | "createFieldNotes"
  | "lookAround"
  | "takeFront"
  | "notesIntro"
  | "typeFront"
  | "swipeNew"
  | "openCompass"
  | "compassCapture"
  | "walking"
  | "takeTrees"
  | "typeTrees"
  | "pressAnnotate"
  | "drawCircle"
  | "moveCircle"
  | "drawArrow"
  | "annotateFree"
  | "typeRh"
  | "typeBaseline"
  | "summary"
  | "continueDoc"
  | "reviewIntro"
  | "reviewAi"
  | "reviewAiAfter"
  | "reviewReorder"
  | "reviewContinue"
  | "detailsIntro"
  | "detailsPlan"
  | "generateDone";

export type TutorialAction =
  | "shutter"
  | "notes"
  | "swipeRight"
  | "compass"
  | "annotate"
  | "annotateFinish"
  | "draw"
  | "continueDoc"
  | "askAi"
  | "reorder"
  | "continueReview"
  | "continueDetails"
  | "homeSplit"
  | "createNotes"
  | "photosphere"
  | "next"
  | "skip"
  | "finished";

export type TutorialEvent =
  | { type: "back" }
  | { type: "next" }
  | { type: "skip" }
  | { type: "language" }
  | { type: "chooseTheme" }
  | { type: "surveyorName" }
  | { type: "takeTutorial" }
  | { type: "newReport" }
  | { type: "createFieldNotes" }
  | { type: "photo" }
  | { type: "note"; value: string }
  | { type: "noteIdle" }
  | { type: "swipeRight" }
  | { type: "onEmptySlot" }
  | { type: "compassOpen" }
  | { type: "walkDone" }
  | { type: "annotateOpen" }
  | { type: "shape"; kind: string }
  | { type: "shapeMoved" }
  | { type: "annotateFinished" }
  | { type: "continueDoc" }
  | { type: "askAi" }
  | { type: "reordered" }
  | { type: "continueDetails" }
  | { type: "continueGenerate" }
  | { type: "planVisible" }
  | { type: "finish" };

export type CoachPlacement = "center" | "top" | "bottom" | "viewport" | "home";

export type CoachSpec = {
  kicker?: string;
  body: string;
  nextLabel?: string;
  skipLabel?: string;
  finishLabel?: string;
  placement: CoachPlacement;
  showPipLegend?: boolean;
  showSwipeHint?: boolean;
};

const ONBOARDING: TutorialBeat[] = [
  "welcome",
  "language",
  "theme",
  "surveyorName",
  "pitch"
];

export function isOnboardingBeat(beat: TutorialBeat): boolean {
  return ONBOARDING.includes(beat);
}

export function isHomeIntroBeat(beat: TutorialBeat): boolean {
  return beat === "newReport" || beat === "createFieldNotes";
}

export const TUTORIAL_TREES_INDEX = 2;
export const TUTORIAL_RH_INDEX = 3;
export const TUTORIAL_BASELINE_INDEX = 4;

export function coachFor(beat: TutorialBeat): CoachSpec | null {
  switch (beat) {
    case "welcome":
      return {
        kicker: t("tutorial.welcomeTitle"),
        body: "",
        placement: "center"
      };
    case "language":
      return { body: t("coach.language"), placement: "center" };
    case "theme":
      return { body: t("coach.theme"), placement: "center" };
    case "surveyorName":
      return { body: t("coach.surveyorName"), placement: "center" };
    case "pitch":
      return {
        body: t("coach.pitch"),
        nextLabel: t("tutorial.take"),
        skipLabel: t("tutorial.skip"),
        placement: "center"
      };
    case "newReport":
      return { body: t("coach.newReport"), placement: "home" };
    case "createFieldNotes":
      return { body: t("coach.createFieldNotes"), placement: "home" };
    case "lookAround":
      return {
        body: t("coach.lookAround"),
        nextLabel: t("common.next"),
        placement: "bottom"
      };
    case "takeFront":
      return { body: t("coach.takeFront"), placement: "bottom" };
    case "notesIntro":
      return {
        body: t("coach.notesIntro"),
        nextLabel: t("common.next"),
        placement: "top"
      };
    case "typeFront":
      return { body: t("coach.typeFront"), placement: "top" };
    case "swipeNew":
      return {
        body: t("coach.swipeNew"),
        placement: "top",
        showSwipeHint: true
      };
    case "openCompass":
      return { body: t("coach.openCompass"), placement: "top" };
    case "compassCapture":
      return { body: t("coach.compassCapture"), placement: "bottom" };
    case "walking":
      return { body: t("coach.walking"), placement: "top" };
    case "takeTrees":
      return { body: t("coach.takeTrees"), placement: "bottom" };
    case "typeTrees":
      return {
        body: t("coach.typeTrees"),
        nextLabel: t("common.next"),
        placement: "top"
      };
    case "pressAnnotate":
      return { body: t("coach.pressAnnotate"), placement: "top" };
    case "drawCircle":
      return {
        kicker: t("coach.drawCircleKicker"),
        body: t("coach.drawCircle"),
        placement: "top"
      };
    case "moveCircle":
      return { body: t("coach.moveCircle"), placement: "top" };
    case "drawArrow":
      return { body: t("coach.drawArrow"), placement: "top" };
    case "annotateFree":
      return { body: t("coach.annotateFree"), placement: "top" };
    case "typeRh":
      return { body: t("coach.typeRh"), placement: "top" };
    case "typeBaseline":
      return { body: t("coach.typeBaseline"), placement: "top" };
    case "summary":
      return {
        body: t("coach.summary"),
        nextLabel: t("common.next"),
        placement: "top"
      };
    case "continueDoc":
      return { body: t("coach.continueDoc"), placement: "top" };
    case "reviewIntro":
      return {
        body: t("coach.reviewIntro"),
        nextLabel: t("common.next"),
        placement: "viewport",
        showPipLegend: true
      };
    case "reviewAi":
      return { body: t("coach.reviewAi"), placement: "viewport" };
    case "reviewAiAfter":
      return {
        body: t("coach.reviewAiAfter"),
        nextLabel: t("common.next"),
        placement: "viewport"
      };
    case "reviewReorder":
      return { body: t("coach.reviewReorder"), placement: "viewport" };
    case "reviewContinue":
      return { body: t("coach.reviewContinue"), placement: "viewport" };
    case "detailsIntro":
      return { body: t("coach.detailsIntro"), placement: "viewport" };
    case "detailsPlan":
      return { body: t("coach.detailsPlan"), placement: "viewport" };
    case "generateDone":
      return {
        body: t("coach.generateDone"),
        finishLabel: t("common.finish"),
        placement: "viewport"
      };
    default:
      return null;
  }
}

export function allows(beat: TutorialBeat, action: TutorialAction): boolean {
  switch (action) {
    case "photosphere":
      return (
        beat === "lookAround" ||
        beat === "takeFront" ||
        beat === "takeTrees"
      );
    case "shutter":
      return (
        beat === "takeFront" ||
        beat === "compassCapture" ||
        beat === "takeTrees"
      );
    case "notes":
      return (
        beat === "typeFront" ||
        beat === "typeTrees" ||
        beat === "pressAnnotate" ||
        beat === "typeRh" ||
        beat === "typeBaseline"
      );
    case "swipeRight":
      return beat === "swipeNew";
    case "compass":
      return beat === "openCompass" || beat === "compassCapture";
    case "annotate":
      return beat === "pressAnnotate";
    case "draw":
      return (
        beat === "drawCircle" ||
        beat === "moveCircle" ||
        beat === "drawArrow" ||
        beat === "annotateFree"
      );
    case "annotateFinish":
      return beat === "annotateFree";
    case "continueDoc":
      return beat === "continueDoc";
    case "askAi":
      return beat === "reviewAi";
    case "reorder":
      return beat === "reviewReorder";
    case "continueReview":
      return beat === "reviewContinue";
    case "continueDetails":
      return beat === "detailsIntro" || beat === "detailsPlan";
    case "homeSplit":
      return beat === "newReport";
    case "createNotes":
      return beat === "createFieldNotes";
    case "next":
      return Boolean(coachFor(beat)?.nextLabel);
    case "skip":
      return beat === "pitch";
    case "finished":
      return beat === "generateDone";
    default:
      return false;
  }
}

export function noteMatchesFront(note: string): boolean {
  return /\bfront\b/i.test(note);
}

export function noteMatchesRh(note: string): boolean {
  return /\brh\s*45\b/i.test(note);
}

export function noteMatchesBaseline(note: string): boolean {
  return /\bbaseline\s+kitchen\b/i.test(note);
}

export type TutorialReduceResult =
  | { beat: TutorialBeat }
  | { exit: "home" | "skip" | "done" };

export function reduceTutorial(
  beat: TutorialBeat,
  event: TutorialEvent
): TutorialReduceResult {
  if (event.type === "back" && isOnboardingBeat(beat)) {
    const i = ONBOARDING.indexOf(beat);
    if (i <= 0) return { exit: "home" };
    return { beat: ONBOARDING[i - 1]! };
  }

  switch (beat) {
    case "welcome":
      if (event.type === "next" || event.type === "language") {
        return { beat: "language" };
      }
      break;
    case "language":
      if (event.type === "language") return { beat: "theme" };
      break;
    case "theme":
      if (event.type === "chooseTheme") return { beat: "surveyorName" };
      break;
    case "surveyorName":
      if (event.type === "surveyorName" || event.type === "next") {
        return { beat: "pitch" };
      }
      break;
    case "pitch":
      if (event.type === "skip") return { exit: "skip" };
      if (event.type === "takeTutorial" || event.type === "next") {
        return { beat: "newReport" };
      }
      break;
    case "newReport":
      if (event.type === "newReport") return { beat: "createFieldNotes" };
      break;
    case "createFieldNotes":
      if (event.type === "createFieldNotes") return { beat: "lookAround" };
      break;
    case "lookAround":
      if (event.type === "next") return { beat: "takeFront" };
      break;
    case "takeFront":
      if (event.type === "photo") return { beat: "notesIntro" };
      break;
    case "notesIntro":
      if (event.type === "next") return { beat: "typeFront" };
      break;
    case "typeFront":
      if (event.type === "note" && noteMatchesFront(event.value)) {
        return { beat: "swipeNew" };
      }
      break;
    case "swipeNew":
      if (event.type === "swipeRight" || event.type === "onEmptySlot") {
        return { beat: "openCompass" };
      }
      break;
    case "openCompass":
      if (event.type === "compassOpen") return { beat: "compassCapture" };
      break;
    case "compassCapture":
      if (event.type === "photo") return { beat: "walking" };
      break;
    case "walking":
      if (event.type === "walkDone") return { beat: "takeTrees" };
      break;
    case "takeTrees":
      if (event.type === "photo") return { beat: "typeTrees" };
      break;
    case "typeTrees":
      if (event.type === "next") return { beat: "pressAnnotate" };
      break;
    case "pressAnnotate":
      if (event.type === "annotateOpen") return { beat: "drawCircle" };
      break;
    case "drawCircle":
      if (event.type === "shape" && event.kind === "circle") {
        return { beat: "moveCircle" };
      }
      break;
    case "moveCircle":
      if (event.type === "shapeMoved") return { beat: "drawArrow" };
      break;
    case "drawArrow":
      if (event.type === "shape" && event.kind === "arrow") {
        return { beat: "annotateFree" };
      }
      break;
    case "annotateFree":
      if (event.type === "annotateFinished") return { beat: "typeRh" };
      break;
    case "typeRh":
      if (event.type === "note" && noteMatchesRh(event.value)) {
        return { beat: "typeBaseline" };
      }
      break;
    case "typeBaseline":
      if (event.type === "note" && noteMatchesBaseline(event.value)) {
        return { beat: "summary" };
      }
      break;
    case "summary":
      if (event.type === "next") return { beat: "continueDoc" };
      break;
    case "continueDoc":
      if (event.type === "continueDoc") return { beat: "reviewIntro" };
      break;
    case "reviewIntro":
      if (event.type === "next") return { beat: "reviewAi" };
      break;
    case "reviewAi":
      if (event.type === "askAi") return { beat: "reviewAiAfter" };
      break;
    case "reviewAiAfter":
      if (event.type === "next") return { beat: "reviewReorder" };
      break;
    case "reviewReorder":
      if (event.type === "reordered") return { beat: "reviewContinue" };
      break;
    case "reviewContinue":
      if (event.type === "continueDetails") return { beat: "detailsIntro" };
      break;
    case "detailsIntro":
      if (event.type === "planVisible") return { beat: "detailsPlan" };
      if (event.type === "continueGenerate") return { beat: "generateDone" };
      break;
    case "detailsPlan":
      if (event.type === "continueGenerate") return { beat: "generateDone" };
      break;
    case "generateDone":
      if (event.type === "finish") return { exit: "done" };
      break;
    default:
      break;
  }
  return { beat };
}

export const TUTORIAL_AI_FALLBACK =
  "Vegetation has established in the roof covering and adjacent masonry of the building, creating a pathway for moisture to enter the structure. The growth should be removed and the affected roof and wall coverings inspected and made good so that a weathertight envelope is restored.";
