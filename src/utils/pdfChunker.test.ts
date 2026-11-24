import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  buildChunkFileName,
  hasPdfMagicHeader,
  splitPdfIntoChunks,
} from './pdfChunker.ts';

async function createSampleMultiPagePdf(pageCount: number, linesPerPage = 18): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Deterministic PRNG for high-entropy lines that do not trivially zlib-collapse
  let seed = 123456789;
  const nextChar = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return String.fromCharCode(33 + (seed % 90));
  };
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    for (let l = 0; l < linesPerPage; l++) {
      let line = `P${i + 1}L${l + 1}: `;
      for (let c = 0; c < 95; c++) line += nextChar();
      page.drawText(line, {
        x: 24,
        y: 800 - l * 22,
        size: 8,
        font,
      });
    }
  }
  return doc.save({ useObjectStreams: true });
}

test('buildChunkFileName formats single and multi-part PDF names cleanly', () => {
  assert.equal(buildChunkFileName('Physics_1st.pdf', 1, 1), 'Physics_1st.pdf');
  assert.equal(buildChunkFileName('Physics_1st.pdf', 2, 5), 'Physics_1st (Part 2 of 5).pdf');
  assert.equal(buildChunkFileName('guide', 1, 3), 'guide (Part 1 of 3).pdf');
});

test('splitPdfIntoChunks rejects non-PDF buffers missing %PDF- header', async () => {
  const fakeBytes = new TextEncoder().encode('NOT A REAL PDF');
  await assert.rejects(
    () => splitPdfIntoChunks(fakeBytes, 'fake.pdf'),
    /%PDF-/
  );
});

test('splitPdfIntoChunks keeps small PDF intact as 1 chunk without re-encoding', async () => {
  const pdfBytes = await createSampleMultiPagePdf(3, 4);
  const chunks = await splitPdfIntoChunks(pdfBytes, 'small.pdf', {
    maxChunkBytes: 5 * 1024 * 1024,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].fileName, 'small.pdf');
  assert.equal(chunks[0].partNumber, 1);
  assert.equal(chunks[0].totalParts, 1);
  assert.equal(chunks[0].bytes, pdfBytes);
});

test('splitPdfIntoChunks splits a multi-page PDF into multiple valid standalone PDF chunks under maxChunkBytes', async () => {
  const pdfBytes = await createSampleMultiPagePdf(12, 22);
  // Choose a tight chunk ceiling (~1/3 of compressed total size) so splitting produces >= 3 valid chunks
  const targetMaxBytes = Math.floor(pdfBytes.byteLength / 3);

  const progressEvents: number[] = [];
  const chunks = await splitPdfIntoChunks(pdfBytes, 'HSC_Physics_Book.pdf', {
    maxChunkBytes: targetMaxBytes,
    onProgress: (p) => {
      if (p.stage === 'splitting') progressEvents.push(p.processedPages);
    },
  });

  assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
  assert.ok(progressEvents.length >= 2);
  assert.equal(progressEvents[progressEvents.length - 1], 12);

  let reconstructedPageTotal = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    assert.equal(chunk.partNumber, i + 1);
    assert.equal(chunk.totalParts, chunks.length);
    assert.match(chunk.fileName, new RegExp(`\\(Part ${i + 1} of ${chunks.length}\\)\\.pdf$`));
    assert.ok(
      chunk.bytes.byteLength <= targetMaxBytes,
      `Chunk ${i + 1} size (${chunk.bytes.byteLength}) exceeded max (${targetMaxBytes})`
    );
    assert.ok(hasPdfMagicHeader(chunk.bytes), `Chunk ${i + 1} missing %PDF- header`);

    // Verify each chunk parses cleanly as an independent valid PDF
    const loadedChunk = await PDFDocument.load(chunk.bytes);
    const chunkPages = loadedChunk.getPageCount();
    assert.equal(chunkPages, chunk.pageEnd - chunk.pageStart + 1);
    reconstructedPageTotal += chunkPages;
  }

  assert.equal(reconstructedPageTotal, 12);
});
