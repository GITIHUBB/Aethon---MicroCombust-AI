'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { FileText, ExternalLink } from 'lucide-react';

const CITATION_RE = /\[([^\[\]]+?\.pdf)\s+(?:p|page)\.?\s*([^\]]+?)\]/gi;

function fileNameOf(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
}

function findMatchingSource(sources, filename, page) {
  if (!sources || !sources.length) return null;
  const targetName = fileNameOf(filename);
  const matches = sources.filter(
    (s) => fileNameOf(s.filename || s.source) === targetName
  );
  if (!matches.length) return null;
  const cleanPage = String(page || '').trim().toLowerCase();
  if (cleanPage && cleanPage !== 'n/a') {
    const pageMatch = matches.find((s) => String(s.page).trim().toLowerCase() === cleanPage);
    if (pageMatch) return pageMatch;
  }
  return matches[0];
}

/** Pre-process raw text for markdown & KaTeX:
 * 1. Convert \[ ... \] to $$ ... $$ and \( ... \) to $ ... $
 * 2. Convert bare chemical formulas like \text{HO}_2 to $\text{HO}_2$ if outside math
 * 3. Convert [file.pdf p.X] to [file.pdf · p.X](cite:file.pdf:X)
 */
function preprocessContent(rawText) {
  if (!rawText) return '';
  let text = String(rawText);

  // 1. Convert LaTeX display and inline delimiters
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // 2. Wrap standalone \text{...} or chemical formulas that are not already enclosed in $
  // Matches \text{...} optionally followed by subscripts/superscripts (e.g. \text{HO}_2, \text{H}_2\text{O})
  text = text.replace(/(?<!\$)(?:\\text\{[A-Za-z0-9_-]+\}(?:_\{?[A-Za-z0-9]+\}?)?)+(?!\$)/g, (match) => {
    return `$${match}$`;
  });

  // 3. Transform inline citations [paper.pdf p.12] into custom markdown links [paper.pdf · p. 12](cite:paper.pdf:12)
  text = text.replace(CITATION_RE, (_match, filename, page) => {
    const cleanFile = filename.trim();
    const cleanPage = (page || 'N/A').trim();
    return `[${cleanFile} · p.${cleanPage}](cite:${cleanFile}:${cleanPage})`;
  });

  return text;
}

export default function MarkdownRenderer({ content, sources = [], onOpenSource }) {
  const processed = useMemo(() => preprocessContent(content), [content]);

  return (
    <div className="markdown-body space-y-3 text-[13.5px] leading-relaxed text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: (props) => (
            <h1 className="text-lg font-bold text-violet-200 mt-4 mb-2 tracking-wide border-b border-violet-400/20 pb-1 flex items-center gap-2" {...props} />
          ),
          h2: (props) => (
            <h2 className="text-[15px] font-semibold text-cyan-300 mt-3.5 mb-1.5 tracking-wide flex items-center gap-2" {...props} />
          ),
          h3: (props) => (
            <h3 className="text-xs font-semibold text-violet-300 uppercase tracking-wider mt-3 mb-1 flex items-center gap-1.5" {...props} />
          ),
          p: (props) => (
            <p className="my-1.5 leading-relaxed text-slate-200" {...props} />
          ),
          ul: (props) => (
            <ul className="my-2 space-y-1 pl-5 list-disc text-slate-300 marker:text-cyan-400/70" {...props} />
          ),
          ol: (props) => (
            <ol className="my-2 space-y-1 pl-5 list-decimal text-slate-300 marker:text-violet-300/70" {...props} />
          ),
          li: (props) => (
            <li className="leading-relaxed pl-0.5" {...props} />
          ),
          strong: (props) => (
            <strong className="font-semibold text-slate-50" {...props} />
          ),
          em: (props) => (
            <em className="text-slate-300 italic" {...props} />
          ),
          code: ({ children, ...props }) => {
            return (
              <code
                className="bg-slate-950/80 border border-slate-800 text-cyan-300 px-1.5 py-0.5 rounded text-[12px] font-mono shadow-inner inline-block"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => (
            <pre className="p-3 my-2 rounded-xl bg-slate-950/90 border border-slate-800 text-xs font-mono overflow-x-auto text-slate-200" {...props}>
              {children}
            </pre>
          ),
          blockquote: (props) => (
            <blockquote className="border-l-2 border-violet-400/60 pl-3.5 py-1.5 my-2.5 bg-violet-400/5 rounded-r-lg text-slate-300 text-xs italic" {...props} />
          ),
          table: (props) => (
            <div className="overflow-x-auto my-3 rounded-xl border border-slate-800/80 bg-slate-950/40">
              <table className="w-full text-left text-xs border-collapse" {...props} />
            </div>
          ),
          thead: (props) => (
            <thead className="bg-slate-900/80 border-b border-slate-800 text-cyan-400 uppercase tracking-wider text-[11px]" {...props} />
          ),
          th: (props) => (
            <th className="px-3 py-2 font-semibold" {...props} />
          ),
          td: (props) => (
            <td className="px-3 py-2 border-t border-slate-800/50 text-slate-300 font-mono" {...props} />
          ),
          hr: () => <hr className="my-3 border-slate-800" />,
          a: ({ href, children, ...props }) => {
            if (href?.startsWith('cite:')) {
              const raw = href.slice(5);
              const colonIdx = raw.lastIndexOf(':');
              const filename = colonIdx > -1 ? raw.slice(0, colonIdx) : raw;
              const page = colonIdx > -1 ? raw.slice(colonIdx + 1) : 'N/A';
              const matched = findMatchingSource(sources, filename, page);

              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenSource?.(
                      matched || {
                        filename,
                        page,
                        snippet: null,
                        source: filename,
                      }
                    );
                  }}
                  title={matched ? `Inspect ChromaDB passage for ${filename}` : `Source paper: ${filename}`}
                  className="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-full border border-cyan-500/35 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 hover:text-cyan-100 font-mono text-[11px] font-medium transition-all duration-150 cursor-pointer align-baseline hover:border-cyan-400/80"
                >
                  <FileText className="w-3 h-3 text-cyan-400 flex-none" aria-hidden="true" />
                  <span className="truncate max-w-[200px]">{children}</span>
                </button>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-200 underline underline-offset-2 decoration-cyan-500/50 hover:decoration-cyan-300 font-medium transition-colors"
                {...props}
              >
                {children}
                <ExternalLink className="w-3 h-3 ml-0.5 inline opacity-70" aria-hidden="true" />
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
