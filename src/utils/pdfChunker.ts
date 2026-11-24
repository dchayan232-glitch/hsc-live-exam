import { PDFDocument } from 'pdf-lib';

export const MAX_TOTAL_PDF_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB total file limit
export const MAX_CHUNK_SIZE_BYTES = 24 * 1024 * 1024; // 24 MB safe ceiling (< 25 MB & safely below Cloud Run 32 MB HTTP limit)

export interface PdfChunk {
  partNumber: number;
  totalParts: number;
  fileName: string;
  bytes: Uint8Array;
  pageStart: number; // 1-indexed inclusive
  pageEnd: number;   // 1-indexed inclusive
}

export interface PdfSplitProgress {
  stage: 'analyzing' | 'splitting';
  processedPages: number;
  totalPages: number;
  chunksCreated: number;
}

export interface SplitPdfOptions {
  maxChunkBytes?: number;
  onProgress?: (progress: PdfSplitProgress) => void;
}

/**
 * Formats a clean `.pdf` filename for a chunk so server-side `.pdf` extension checks
 * always pass and teachers can easily identify parts in the Knowledge Base list.
 */
export function buildChunkFileName(
  originalFileName: string,
  partNumber: number,
  totalParts: number
): string {
  const cleanName = originalFileName.trim() || 'document.pdf';
  if (totalParts <= 1) {
    return cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`;
  }
  const base = cleanName.replace(/\.pdf$/i, '').slice(0, 85).trim() || 'document';
  return `${base} (Part ${partNumber} of ${totalParts}).pdf`;
}

/**
 * Checks whether a byte buffer starts with the standard ASCII `%PDF-` header.
 */
export function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  );
}

/**
 * Formats bytes into a concise MB string (e.g., "18.4 MB").
 */
export function formatFileSizeMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

/**
 * Splits a PDF buffer into one or more valid standalone PDF chunks, each strictly
 * under `maxChunkBytes` (default 24 MB, safely below Cloud Run's 32 MB limit and
 * Gemini File Search Store's 100 MB limit).
 *
 * If the input PDF is already <= `maxChunkBytes`, returns it directly as 1 chunk
 * without re-encoding.
 */
export async function splitPdfIntoChunks(
  sourceBytes: Uint8Array,
  originalFileName: string,
  options: SplitPdfOptions = {}
): Promise<PdfChunk[]> {
  const maxChunkBytes = options.maxChunkBytes ?? MAX_CHUNK_SIZE_BYTES;
  const onProgress = options.onProgress;

  if (!hasPdfMagicHeader(sourceBytes)) {
    throw new Error('নির্বাচিত ফাইলটি বৈধ PDF নথি নয় (%PDF- হেডার পাওয়া যায়নি)।');
  }

  // Fast path: already fits comfortably in a single upload chunk
  if (sourceBytes.byteLength <= maxChunkBytes) {
    return [
      {
        partNumber: 1,
        totalParts: 1,
        fileName: buildChunkFileName(originalFileName, 1, 1),
        bytes: sourceBytes,
        pageStart: 1,
        pageEnd: 1,
      },
    ];
  }

  onProgress?.({
    stage: 'analyzing',
    processedPages: 0,
    totalPages: 0,
    chunksCreated: 0,
  });

  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
  } catch {
    throw new Error(
      'বড় PDF ফাইলটি ভাগ করা যায়নি (ফাইলটি পাসওয়ার্ড-সুরক্ষিত বা ক্ষতিগ্রস্ত হতে পারে)।'
    );
  }

  const totalPages = sourceDoc.getPageCount();
  if (totalPages === 0) {
    throw new Error('PDF ফাইলটিতে কোনো পৃষ্ঠা পাওয়া যায়নি।');
  }

  // Target ~75% of maxChunkBytes per initial page batch to account for shared fonts/resources
  const avgBytesPerPage = Math.max(1, sourceBytes.byteLength / totalPages);
  const initialBatchPages = Math.max(
    1,
    Math.min(totalPages, Math.floor((maxChunkBytes * 0.75) / avgBytesPerPage))
  );

  const rawChunks: Array<{ bytes: Uint8Array; pageStart: number; pageEnd: number }> = [];
  let cursor = 0;

  while (cursor < totalPages) {
    let batchSize = Math.min(initialBatchPages, totalPages - cursor);
    let savedBytes: Uint8Array | null = null;

    // Adaptive shrink loop: guarantees every chunk is strictly <= maxChunkBytes
    while (batchSize >= 1) {
      const pageIndices: number[] = [];
      for (let i = 0; i < batchSize; i++) {
        pageIndices.push(cursor + i);
      }

      const chunkDoc = await PDFDocument.create();
      const copiedPages = await chunkDoc.copyPages(sourceDoc, pageIndices);
      for (const page of copiedPages) {
        chunkDoc.addPage(page);
      }

      const candidateBytes = await chunkDoc.save({ useObjectStreams: true });

      if (candidateBytes.byteLength <= maxChunkBytes) {
        savedBytes = candidateBytes;
        break;
      }

      if (batchSize === 1) {
        throw new Error(
          `পৃষ্ঠা ${cursor + 1} এককভাবেই ${formatFileSizeMb(candidateBytes.byteLength)} — যা প্রতি অংশের সর্বোচ্চ সীমা (${formatFileSizeMb(maxChunkBytes)}) অতিক্রম করেছে। অনুগ্রহ করে PDF-টি একটু কম্প্রেস করে চেষ্টা করুন।`
        );
      }

      // Proportionally reduce batch size (at least halving when very close)
      const ratio = (maxChunkBytes * 0.82) / candidateBytes.byteLength;
      const nextBatch = Math.min(batchSize - 1, Math.max(1, Math.floor(batchSize * ratio)));
      batchSize = nextBatch;
    }

    if (!savedBytes || !hasPdfMagicHeader(savedBytes)) {
      throw new Error('PDF অংশ তৈরি করতে ত্রুটি হয়েছে।');
    }

    rawChunks.push({
      bytes: savedBytes,
      pageStart: cursor + 1,
      pageEnd: cursor + batchSize,
    });

    cursor += batchSize;
    onProgress?.({
      stage: 'splitting',
      processedPages: cursor,
      totalPages,
      chunksCreated: rawChunks.length,
    });
  }

  const totalParts = rawChunks.length;
  return rawChunks.map((chunk, idx) => ({
    partNumber: idx + 1,
    totalParts,
    fileName: buildChunkFileName(originalFileName, idx + 1, totalParts),
    bytes: chunk.bytes,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
  }));
}
