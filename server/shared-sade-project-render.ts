import { execFile } from 'node:child_process';
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import pptxgen from 'pptxgenjs';
import { resolveProviderPath } from './provider-files.ts';
import { DomainError } from './store.ts';

const run = promisify(execFile);
const text = (max: number) => z.string().trim().min(1).max(max);
const source = z.strictObject({ title: text(350), url: z.url({ protocol: /^https$/ }).max(800) });
const paperInput = z
  .strictObject({
    title: text(180),
    abstract: text(2000),
    sections: z
      .array(
        z.strictObject({
          title: text(160),
          body: text(6500),
          citations: z.array(z.int().min(1).max(32)).max(16),
        }),
      )
      .min(1)
      .max(12),
    sources: z.array(source).max(32),
  })
  .refine(
    ({ sections, sources }) =>
      sections.every(({ citations }) => citations.every((index) => index <= sources.length)),
    { message: 'Every citation must refer to an index from the supplied sources.' },
  );
const slidesInput = z.strictObject({
  title: text(130),
  slides: z
    .array(
      z.strictObject({
        title: text(130),
        bullets: z.array(text(210)).min(1).max(5),
        source: text(220).optional(),
      }),
    )
    .min(1)
    .max(16),
});

const titleSchema = { type: 'string' };
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'url'],
  properties: { title: titleSchema, url: titleSchema },
};
export const projectCompileTool = {
  type: 'function' as const,
  name: 'relay_project_compile_paper',
  description:
    'Write the LaTeX source and bibliography and compile the same draft to PDF in your assigned workspace. Supply plain text sections and indexes into the sources. Available to the paper author only.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'abstract', 'sections', 'sources'],
    properties: {
      title: titleSchema,
      abstract: titleSchema,
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'body', 'citations'],
          properties: {
            title: titleSchema,
            body: titleSchema,
            citations: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
      sources: { type: 'array', items: sourceSchema },
    },
  },
};
export const projectSlidesTool = {
  type: 'function' as const,
  name: 'relay_project_render_slides',
  description:
    'Render your verified outline and source-grounded bullets to PowerPoint. Write the slide outline for independent audit. Available to the slides task only.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slides'],
    properties: {
      title: titleSchema,
      slides: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'bullets'],
          properties: {
            title: titleSchema,
            bullets: { type: 'array', items: titleSchema },
            source: titleSchema,
          },
        },
      },
    },
  },
};

const escapes: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};
const latex = (value: string) => value.replace(/[\\{}$&#%_^~]/g, (character) => escapes[character]);

async function target(
  worktree: string,
  outputs: readonly string[],
  name: string,
  current: () => void,
) {
  const file = outputs.find((entry) => path.posix.basename(entry) === name);
  if (!file) throw new DomainError('The project did not grant that output.', 403);
  const { target } = await resolveProviderPath(worktree, file);
  await mkdir(path.dirname(target), { recursive: true });
  const info = await lstat(target).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (info && (!info.isFile() || info.nlink !== 1))
    throw new DomainError('Only private, regular files can be exported.');
  current();
  return target;
}

export async function compileProjectPaper(
  worktree: string,
  outputs: string[],
  raw: unknown,
  current: () => void,
) {
  const spec = paperInput.parse(raw);
  const [tex, bib, pdf] = await Promise.all([
    target(worktree, outputs, 'paper.tex', current),
    target(worktree, outputs, 'references.bib', current),
    target(worktree, outputs, 'paper.pdf', current),
  ]);
  const bibliography = spec.sources
    .map(
      (item, index) =>
        `@misc{source${index + 1},\n  title={${latex(item.title)}},\n  note={${latex(item.url)}}\n}`,
    )
    .join('\n');
  const body = spec.sections
    .map((section) =>
      [
        '\\section{' + latex(section.title) + '}',
        latex(section.body),
        ...(section.citations.length
          ? ['\\cite{' + section.citations.map((i) => 'source' + i).join(',') + '}']
          : []),
      ].join('\n'),
    )
    .join('\n\n');
  const document = [
    '\\documentclass[11pt]{article}',
    '\\usepackage{fontspec}',
    '\\usepackage[margin=1in]{geometry}',
    '\\title{' + latex(spec.title) + '}',
    '\\author{}',
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    '\\begin{abstract}',
    latex(spec.abstract),
    '\\end{abstract}',
    body,
    ...(spec.sources.length ? ['\\bibliographystyle{plain}', '\\bibliography{references}'] : []),
    '\\end{document}',
    '',
  ].join('\n');
  current();
  await writeFile(tex, document, 'utf8');
  current();
  await writeFile(bib, bibliography || '@comment{No sources supplied.}\n', 'utf8');
  const cwd = path.dirname(tex);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(PATH|PATHEXT|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|XDG_CACHE_HOME)$/i.test(
        name,
      ),
    ),
  );
  try {
    await run('tectonic', ['-X', 'compile', '--untrusted', '--outdir', cwd, path.basename(tex)], {
      cwd,
      env,
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 256 * 1024,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT')
      throw new DomainError(
        'Install Tectonic on this harness, or use an approved paired machine with a LaTeX compiler.',
      );
    throw new DomainError(
      'LaTeX did not compile. Check the Tectonic bundle and compilation tools on this harness.',
    );
  }
  current();
  if (!(await lstat(pdf).catch(() => undefined))?.isFile())
    throw new DomainError('The compiler did not produce paper.pdf.');
  return {
    compiled: true,
    sources: spec.sources.length,
    files: ['paper.tex', 'references.bib', 'paper.pdf'],
  };
}

type PowerPointSlide = z.infer<typeof slidesInput>['slides'][number] & {
  bulletLinks?: string[];
};

export async function renderSadePowerPoint(spec: { title: string; slides: PowerPointSlide[] }) {
  const presentation = new pptxgen();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.title = spec.title;
  const cover = presentation.addSlide();
  cover.background = { color: '112C2A' };
  cover.addText(spec.title, {
    x: 0.8,
    y: 2.0,
    w: 11.7,
    h: 2.8,
    fontFace: 'Aptos Display',
    fontSize: 36,
    color: 'FFFFFF',
    bold: true,
    fit: 'shrink',
  });
  for (const item of spec.slides) {
    const slide = presentation.addSlide();
    slide.background = { color: 'F5F7F4' };
    slide.addText(item.title, {
      x: 0.8,
      y: 0.55,
      w: 11.7,
      h: 1.25,
      fontFace: 'Aptos Display',
      fontSize: 31,
      color: '112C2A',
      bold: true,
      fit: 'shrink',
    });
    slide.addText(
      item.bullets.map((bullet, index) => {
        const url = item.bulletLinks?.[index];
        return {
          text: bullet,
          options: { bullet: true, breakLine: true, ...(url && { hyperlink: { url } }) },
        };
      }),
      {
        x: 0.85,
        y: 2.0,
        w: 11.65,
        h: 4.35,
        fontFace: 'Aptos',
        fontSize: 21,
        color: '182C29',
        fit: 'shrink',
      },
    );
    if (item.source)
      slide.addText(item.source, {
        x: 0.85,
        y: 6.7,
        w: 11.6,
        h: 0.45,
        fontFace: 'Aptos',
        fontSize: 10,
        color: '455C57',
        fit: 'shrink',
      });
  }
  const bytes = await presentation.write({ outputType: 'nodebuffer', compression: true });
  if (!Buffer.isBuffer(bytes))
    throw new DomainError('PowerPoint renderer returned an invalid package.');
  return bytes;
}

export async function renderProjectSlides(
  worktree: string,
  outputs: string[],
  raw: unknown,
  current: () => void,
) {
  const spec = slidesInput.parse(raw);
  const [destination, outline] = await Promise.all([
    target(worktree, outputs, 'slides.pptx', current),
    target(worktree, outputs, 'slides.md', current),
  ]);
  const bytes = await renderSadePowerPoint(spec);
  current();
  await writeFile(destination, bytes);
  current();
  await writeFile(
    outline,
    [
      '# ' + spec.title,
      ...spec.slides.flatMap(({ title, bullets, source }) => [
        '',
        '## ' + title,
        '',
        ...bullets.map((bullet) => '- ' + bullet),
        ...(source ? ['', source] : []),
      ]),
    ].join('\n') + '\n',
    'utf8',
  );
  return {
    rendered: true,
    totalSlides: spec.slides.length + 1,
    files: ['slides.pptx', 'slides.md'],
  };
}
