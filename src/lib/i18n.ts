import { useEffect, useState } from "react";
import catalog from "../data/ui-strings.json";
import {
  loadTutorialLanguage,
  saveTutorialLanguage,
  type TutorialLanguage
} from "./tutorial/progress";

export type UiLanguage = TutorialLanguage;

export type UiPhrase = {
  en: string;
  cy: string;
  ga: string;
  gd: string;
};

type CatalogNode = UiPhrase | { [key: string]: CatalogNode };

const listeners = new Set<() => void>();

let currentLang: UiLanguage = loadTutorialLanguage() ?? "en";

function isPhrase(value: unknown): value is UiPhrase {
  return Boolean(
    value &&
      typeof value === "object" &&
      "en" in value &&
      typeof (value as UiPhrase).en === "string"
  );
}

function lookup(key: string): UiPhrase | null {
  const parts = key.split(".");
  let node: CatalogNode = catalog as CatalogNode;
  for (const part of parts) {
    if (!node || typeof node !== "object" || isPhrase(node)) return null;
    node = (node as Record<string, CatalogNode>)[part];
  }
  return isPhrase(node) ? node : null;
}

export function getUiLanguage(): UiLanguage {
  return currentLang;
}

export function setUiLanguage(lang: UiLanguage): void {
  currentLang = lang;
  saveTutorialLanguage(lang);
  listeners.forEach((fn) => fn());
}

export function subscribeUiLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const phrase = lookup(key);
  const raw = (phrase?.[currentLang] || phrase?.en || key).toString();
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

/** Re-renders when the UI language changes. */
export function useT(): typeof t {
  const [, setTick] = useState(0);
  useEffect(() => subscribeUiLanguage(() => setTick((n) => n + 1)), []);
  return t;
}

export function useUiLanguage(): UiLanguage {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => subscribeUiLanguage(() => setLang(currentLang)), []);
  return lang;
}
