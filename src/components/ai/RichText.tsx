"use client";

import { Fragment, type ReactNode } from "react";

// Minimal, safe renderer for Ringo AI replies: paragraphs, bullet/numbered
// lists, headings, **bold**, `code`, and Markdown links. Never uses
// dangerouslySetInnerHTML — everything becomes React text nodes. Only
// in-app links (paths starting with "/dashboard") become clickable, so a
// reply can deep-link to a real Dashboard section but can never send the
// user to an external site.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const match of Array.from(text.matchAll(pattern))) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-ringo-muted/10 text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const label = token.slice(1, token.indexOf("]("));
      const href = token.slice(token.indexOf("](") + 2, -1);
      nodes.push(
        href.startsWith("/dashboard") ? (
          <a key={key} href={href} className="font-medium text-ringo-indigo underline underline-offset-2">
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        )
      );
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block = { kind: "p" | "h"; text: string } | { kind: "ul" | "ol"; items: string[] };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = (bullet || numbered)![1];
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export default function RichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        if ("text" in b) {
          return b.kind === "h" ? (
            <p key={i} className="font-semibold">{renderInline(b.text, `h${i}`)}</p>
          ) : (
            <p key={i} className="whitespace-pre-wrap">{renderInline(b.text, `p${i}`)}</p>
          );
        }
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`${b.kind === "ul" ? "list-disc" : "list-decimal"} pl-5 flex flex-col gap-1`}>
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
