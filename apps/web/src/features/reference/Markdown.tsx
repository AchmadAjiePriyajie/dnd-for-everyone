import { Fragment, type ReactNode } from 'react';
import type { Id } from '#shared/contracts';

/**
 * Renderer Markdown terbatas untuk teks corpus: heading, paragraf, daftar, tabel,
 * kutipan, tebal/miring dan tautan `ref:`. Semua teks menjadi node React biasa,
 * sehingga HTML/script di dalam teks hanya tampil sebagai teks dan tidak dieksekusi.
 * Tautan selain `ref:` ditampilkan sebagai teks (tidak ada tautan eksternal).
 */
export function Markdown({ text, refHref, onRef }: { text: string; refHref(id: Id): string; onRef(id: Id): void }) {
  const inline = (value: string) => renderInline(value, refHref, onRef);
  return <>{parseBlocks(text).map((block, index) => renderBlock(block, index, inline))}</>;
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'table'; rows: string[][]; header: boolean };

const BULLET = /^\s*(?:[-*•])\s+/;

function parseBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      const lines = chunk.split('\n');
      const heading = /^(#{1,6})\s+(.*)$/.exec(chunk);
      if (heading && lines.length === 1) return { type: 'heading', level: heading[1]!.length, text: heading[2]! };
      if (lines.every((line) => line.startsWith('|'))) {
        const header = lines.length > 1 && /^\|(\s*:?-{2,}:?\s*\|)+$/.test(lines[1]!.replace(/\s/g, ''));
        const rows = lines.filter((_, i) => !(header && i === 1)).map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
        return { type: 'table', rows, header };
      }
      if (lines.every((line) => line.startsWith('>'))) return { type: 'quote', lines: lines.map((line) => line.replace(/^>\s?/, '')) };
      if (lines.every((line) => BULLET.test(line))) return { type: 'list', items: lines.map((line) => line.replace(BULLET, '')) };
      return { type: 'paragraph', lines };
    });
}

function renderBlock(block: Block, key: number, inline: (value: string) => ReactNode): ReactNode {
  switch (block.type) {
    case 'heading': {
      // Heading isi entri berada di bawah judul entri (h2), jadi mulai dari h3.
      const Tag = `h${Math.min(6, block.level + 2)}` as 'h3';
      return <Tag key={key}>{inline(block.text)}</Tag>;
    }
    case 'list':
      return (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
    case 'quote':
      return <blockquote key={key}>{lines(block.lines, inline)}</blockquote>;
    case 'table': {
      const [head, ...body] = block.header ? block.rows : [undefined, ...block.rows];
      return (
        <div className="table-scroll" key={key}>
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} scope="col">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row!.map((cell, i) => (
                    <td key={i}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return <p key={key}>{lines(block.lines, inline)}</p>;
  }
}

function lines(values: string[], inline: (value: string) => ReactNode): ReactNode {
  return values.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

const INLINE = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(value: string, refHref: (id: Id) => string, onRef: (id: Id) => void): ReactNode {
  return value.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('***') && part.endsWith('***') && part.length > 6) {
      return (
        <strong key={i}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, target] = link;
      if (!target!.startsWith('ref:')) return <Fragment key={i}>{label}</Fragment>;
      const id = target!.slice(4);
      return (
        <a
          key={i}
          href={refHref(id)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onRef(id);
          }}
        >
          {label}
        </a>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
