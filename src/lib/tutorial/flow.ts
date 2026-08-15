export type TutorialBeat =
  | "welcome"
  | "language"
  | "theme"
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

const ONBOARDING: TutorialBeat[] = ["welcome", "language", "theme", "pitch"];

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
        kicker: "Welcome to Dampmaster report studio",
        body: "",
        placement: "center"
      };
    case "language":
      return {
        body: "Please choose a language: English, Welsh, Irish, Scottish.\nYou can change these settings at any time.",
        placement: "center"
      };
    case "theme":
      return {
        body: "Please choose a theme: light / dark\nYou can change these settings at any time.",
        placement: "center"
      };
    case "pitch":
      return {
        body: "Please consider taking this quick interactive tutorial to learn how to use report studio.",
        nextLabel: "Take tutorial",
        skipLabel: "Skip",
        placement: "center"
      };
    case "newReport":
      return {
        body: "**Press the new report button to start.**",
        placement: "home"
      };
    case "createFieldNotes":
      return {
        body: "To import a survey from Report and Run, press share then download the Report and Run document to your device, then press import field notes in this app to start.\n\nAlternatively, this new app can replace Report and Run using the field notes interface. **Press create new field notes to start.**",
        placement: "home"
      };
    case "lookAround":
      return {
        body: "You have now entered the field notes interface. In front of you is a simulation of the old valve house. **Turn your phone to look around.**",
        nextLabel: "Next",
        placement: "bottom"
      };
    case "takeFront":
      return {
        body: "In the top of this interface you can see your camera’s viewfinder and camera controls. **Take a picture of the front elevation of the old valve house**, to be included in the survey report.",
        placement: "bottom"
      };
    case "notesIntro":
      return {
        body: "Well done! Now we move to the bottom of this interface. This is the notes section, here you can add notes about the observations you have made about the associated image.",
        nextLabel: "Next",
        placement: "top"
      };
    case "typeFront":
      return {
        body: "You don’t need to make full detailed notes at this point. You can write short notes to finish later, or you may decide to use keywords that automatically activate standard Dampmaster wording for common elements of reports such as the front elevation. In the notes section, **simply type “front”.**",
        placement: "top"
      };
    case "swipeNew":
      return {
        body: "Great, now we can move on to the next observation. At any point swipe left or right on the screen to move between observations. To new observations, the camera is always located at the rightmost slide. **Swipe the screen to make a new note.**",
        placement: "bottom",
        showSwipeHint: true
      };
    case "openCompass":
      return {
        body: "Another standard observation is the cardinal direction the property is facing. **Press the compass button in the bottom right corner of the viewfinder** to enter the compass view.",
        placement: "top"
      };
    case "compassCapture":
      return {
        body: "While performing a survey, stand outside the front of the property and **point the top of the phone away from the building and press the camera button.** This will automatically insert the correct standard wording into the survey.",
        placement: "bottom"
      };
    case "walking":
      return {
        body: "Please wait while we walk around the back of the building.",
        placement: "top"
      };
    case "takeTrees":
      return {
        body: "A small tree has begun to grow from the roof and side of the building. This may be creating an opening for damp and moisture to enter the building. **Take a picture of the trees in the roof.**",
        placement: "bottom"
      };
    case "typeTrees":
      return {
        body: "**Now write a short note about the trees.** You can come back and add more before annotating.",
        nextLabel: "Next",
        placement: "top"
      };
    case "pressAnnotate":
      return {
        body: "Similar to Report and Run, this app can also write annotations inside images to show exactly what is being discussed in the attached text segment. You can still edit the tree notes below. **Press annotate to edit this image.**",
        placement: "top"
      };
    case "drawCircle":
      return {
        kicker: "Welcome to the annotate screen",
        body: "**Try drawing a circle.**",
        placement: "top"
      };
    case "moveCircle":
      return {
        body: "**Now move it to the tree in the roof.**",
        placement: "top"
      };
    case "drawArrow":
      return {
        body: "**Now try drawing an arrow instead.**",
        placement: "top"
      };
    case "annotateFree":
      return {
        body: "You can turn off the auto shape detection with the toggle in the bottom. You can also switch between brush and eraser at the bottom or by double tapping quickly anywhere in the image. **Press finished when you are done.**",
        placement: "top"
      };
    case "typeRh":
      return {
        body: "Some more notes have been added to this survey for you. Some keywords contain two parts, the first part is the keyword and the second is the value. For example this image is of a relative humidity detector. It has determined that the relative humidity here is 45%. In the notes section **type “rh 45”** to note this down.",
        placement: "top"
      };
    case "typeBaseline":
      return {
        body: "This baseline reading was taken in the kitchen. **Type “baseline kitchen” in the notes section.**",
        placement: "top"
      };
    case "summary":
      return {
        body: "On the bottom half of the screen you can see standard sections that you may want to consider adding on the left, and information about the notes you have taken on the right.",
        nextLabel: "Next",
        placement: "top"
      };
    case "continueDoc":
      return {
        body: "In the bottom right you can save your notes as a survey file that is unique to this app, or as a Word document that will appear similar to ones produced by Report and Run. Alternatively you can continue straight into the document creation section of this app. This is what we will do now. **Press continue to document.**",
        placement: "top"
      };
    case "reviewIntro":
      return {
        body: "This is the first page of the document process. Here you can organise and word your observations in a client ready format. If you wish to go back and add more notes, you can switch between document and field notes mode freely. On the right you can see the navigation bar. Each segment on this bar represents an image and its associated text. The colour of the segment represents the status of that segment according to these rules:",
        nextLabel: "Next",
        placement: "viewport",
        showPipLegend: true
      };
    case "reviewAi":
      return {
        body: "In addition to a convenient interface to access Dampmaster standard wording for common observations, this app also gives surveyors the option to use an integrated AI agent to help convert short field notes into professional paragraphs. The AI has access to the image, field notes, and any additional information in the text area. If you are happy with the field note, **press the Ask AI button** to help convert the field notes about the trees into a full and professional sounding segment.",
        placement: "viewport"
      };
    case "reviewAiAfter":
      return {
        body: "You should always read AI responses to ensure they are correct. In order to use AI features within this app you must get an API key from one of the numerous providers supported by this app. Some providers such as Open Router offer free plans, while paid options may produce faster and higher quality results. See instructions in the guide page after this tutorial.",
        nextLabel: "Next",
        placement: "viewport"
      };
    case "reviewReorder":
      return {
        body: "From this interface you can rearrange the order of the segments by holding your finger on a segment and then dragging it above or below other segments. **Try to move any segment.**",
        placement: "viewport"
      };
    case "reviewContinue":
      return {
        body: "In this interface you can also choose to add standard wording segments from the standard wording search feature, enter the annotation screen to draw on pictures, and manually write the segments. When you are happy with your observations, **press the continue button at the bottom of the screen.**",
        placement: "viewport"
      };
    case "detailsIntro":
      return {
        body: "Welcome to the report details page. You have finished the part of the document explaining what observations you made at the client property. You can now fill in the details of the property and select which overarching issues you have identified and which recommendations you choose to give the client. The AI agent can help here by making suggestions for which options to pick based on the observations made on the previous page, but you should still always check its answers.",
        placement: "viewport"
      };
    case "detailsPlan":
      return {
        body: "Finally, you can provide a project plan and costs. First you choose what services you can provide for this property by checking the appropriate boxes. Once you have chosen which projects may be necessary, you scroll down further and fill in the cost for each service. Not all surveys require a project plan. You can quickly disable this section and remove all financial boilerplate text from the final document by pressing the Exclude plan & costs toggle at the top of this segment. Once you are finished with your document, **press continue again to generate the document.**",
        placement: "viewport"
      };
    case "generateDone":
      return {
        body: "Congratulations, you have finished your report. You can now share it as a Microsoft Word document or as a PDF. All past reports are always saved inside this app.\n\nIf you want to make any unique changes to the document, you are still capable of opening the document in Microsoft Word or other similar software to add anything this app was not designed for.\n\nThis concludes the tutorial.",
        finishLabel: "Finish",
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
      if (event.type === "chooseTheme") return { beat: "pitch" };
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
