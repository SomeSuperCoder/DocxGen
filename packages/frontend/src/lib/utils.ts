import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Removes HTML tags and markdown emphasis that models put into business text (<b>, **…**). */
export function stripMarkup(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}
