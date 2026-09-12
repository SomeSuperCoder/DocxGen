import React from "react";

interface RichTextProps {
  text: string;
  maxLength?: number;
}

/** Tags we recognise. Values map to a formatting flag. */
const TAG_MAP: Record<string, "bold" | "italic" | "underline"> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
};

/**
 * Parses a string containing `<b>`, `<strong>`, `<i>`, `<em>`, `<u>` tags
 * into nested React elements. Unknown tags are treated as literal text.
 */
export function RichText({ text, maxLength }: RichTextProps) {
  const source = maxLength != null ? text.slice(0, maxLength) : text;
  if (!source) return null;

  const elements: React.ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let bold = false;
  let italic = false;
  let underline = false;

  function flush() {
    if (!buffer) return;
    let el: React.ReactNode = buffer;
    if (italic) el = <em>{el}</em>;
    if (bold) el = <b>{el}</b>;
    if (underline) {
      el = <span style={{ textDecoration: "underline" }}>{el}</span>;
    }
    elements.push(
      <span key={elements.length}>{el}</span>,
    );
    buffer = "";
  }

  while (i < source.length) {
    if (source[i] !== "<") {
      buffer += source[i];
      i++;
      continue;
    }

    // Try to parse a tag.
    const isClosing = source[i + 1] === "/";
    const nameStart = isClosing ? i + 2 : i + 1;
    let nameEnd = nameStart;
    while (nameEnd < source.length && /[a-zA-Z]/.test(source[nameEnd])) nameEnd++;

    const rawName = source.slice(nameStart, nameEnd).toLowerCase();
    let scan = nameEnd;
    while (scan < source.length && source[scan] === " ") scan++;

    if (scan < source.length && source[scan] === ">" && TAG_MAP[rawName]) {
      // Valid recognised tag — update state.
      flush();
      const flag = TAG_MAP[rawName];
      if (flag === "bold") bold = !isClosing;
      else if (flag === "italic") italic = !isClosing;
      else if (flag === "underline") underline = !isClosing;
      i = scan + 1;
    } else {
      // Not a recognised tag — keep the `<` as literal text.
      buffer += source[i];
      i++;
    }
  }

  flush();
  return <>{elements}</>;
}
