/**
 * Benchmark human-review workflow (ADR-026): blinded packets, separate submissions, safe merge,
 * disagreement reporting and corpus readiness audits.
 *
 * Everything here is pure and offline: it reads parsed JSON values and returns plain data, never the
 * application database, a network, or a clock. Timestamps and reviewer identities come from the human
 * submitting the work; the tool never invents a label, a reviewer, a timestamp, a permission, or a
 * gold answer. The reviewer packet is deliberately blinded: it excludes gold labels, existing
 * annotations, and any evaluator output, so a review is not anchored by what the tool already did.
 *
 * These workflow artifacts are new file formats with their own versions; the benchmark *case* contract
 * is unchanged (`benchmark-case-v1`/`v2` still read), so no corpus migration is implied.
 */
import { createHash } from 'node:crypto';
import type { BenchmarkCase, BenchmarkDimension, BenchmarkInputPack } from './types.ts';

export const REVIEW_PACKET_VERSION = 'benchmark-packet-v1';
export const SUBMISSION_VERSION = 'benchmark-submission-v1';

const PACKET_INSTRUCTIONS =
  'Label every subject from the frozen input only. Judge each dimension on its own evidence; a ' +
  'refusal is not a denial, silence is not a wrong statement, and absence of recorded evidence is ' +
  'not contradiction. Do not add knowledge the case does not contain. Read the annotation rubric ' +
  '(docs/evaluator/BENCHMARK_ANNOTATION_RUBRIC.md) before labelling.';

/** A single (dimension, subject) the reviewer must judge. */
export interface ReviewerSubject {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
}

/** What a reviewer is shown: the frozen input and the subjects, with no gold or prior output. */
export interface ReviewerPacket {
  readonly version: string;
  readonly caseId: string;
  readonly packetHash: string;
  readonly subjects: readonly ReviewerSubject[];
  readonly input: BenchmarkInputPack;
  readonly instructions: string;
}

/** One label a reviewer recorded for one subject. */
export interface SubmissionAnnotation {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly label: string;
  readonly rationale: string;
}

/** A reviewer's separate submission, bound to a packet by its hash. */
export interface AnnotationSubmission {
  readonly version: string;
  readonly caseId: string;
  readonly packetHash: string;
  readonly reviewer: string;
  readonly submittedAt: string;
  readonly annotations: readonly SubmissionAnnotation[];
}

/** Recursively sort object keys so a hash depends on content, not on serialisation order. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, canonicalise(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/** A stable, key-order-independent content hash (SHA-256 hex) of any JSON value. */
export function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(value)), 'utf8')
    .digest('hex');
}

/**
 * The subjects a case must be labelled on, derived from its input pack alone.
 *
 * Evidence support is a property of a proposition; answer fidelity, citation support and attribution
 * are properties of a recorded statement. Deriving subjects from the input — never from the gold
 * labels — keeps the packet blind: a subject list copied from `expected` would leak which labels exist.
 */
export function deriveSubjects(input: BenchmarkInputPack): ReviewerSubject[] {
  const subjects: ReviewerSubject[] = [];
  for (const proposition of input.propositions) {
    subjects.push({ dimension: 'EVIDENCE_SUPPORT', subjectId: proposition.id });
  }
  for (const statement of input.statements) {
    subjects.push({ dimension: 'ANSWER_FIDELITY', subjectId: statement.id });
    subjects.push({ dimension: 'CITATION_SUPPORT', subjectId: statement.id });
    subjects.push({ dimension: 'ATTRIBUTION', subjectId: statement.id });
  }
  return subjects;
}

/** Build the blinded packet for a case: input + subjects + hash, with gold/annotations/output removed. */
export function buildReviewerPacket(benchmarkCase: BenchmarkCase): ReviewerPacket {
  const subjects = deriveSubjects(benchmarkCase.input);
  // The hash covers exactly what the reviewer sees that binds the judgement to the frozen input.
  const packetHash = contentHash({
    version: REVIEW_PACKET_VERSION,
    caseId: benchmarkCase.id,
    subjects,
    input: benchmarkCase.input,
  });
  return {
    version: REVIEW_PACKET_VERSION,
    caseId: benchmarkCase.id,
    packetHash,
    subjects,
    input: benchmarkCase.input,
    instructions: PACKET_INSTRUCTIONS,
  };
}

/**
 * A submission skeleton for one packet: one empty annotation per subject. Nothing is pre-filled — the
 * reviewer supplies the label, rationale, their own identity and their own timestamp.
 */
export function buildSubmissionTemplate(packet: ReviewerPacket): AnnotationSubmission {
  return {
    version: SUBMISSION_VERSION,
    caseId: packet.caseId,
    packetHash: packet.packetHash,
    reviewer: '',
    submittedAt: '',
    annotations: packet.subjects.map((subject) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: '',
      rationale: '',
    })),
  };
}
