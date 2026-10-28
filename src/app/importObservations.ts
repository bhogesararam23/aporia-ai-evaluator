import {
  validateCitationDraftInput,
  validateObservationAssessmentDraftInput,
  validateObservationDraftInput,
  type CitationDraftInput,
  type ObservationAssessmentDraftInput,
  type ObservationDraftInput,
} from '../core/inputs.ts';
import {
  invalid,
  invalidMany,
  integerInRange,
  type ValidationIssue,
  type ValidationResult,
  valid,
} from '../core/validation.ts';

export interface ObservationImportRow {
  readonly queryOrdinal: number;
  readonly observation: Omit<ObservationDraftInput, 'queryId'>;
  readonly citations: readonly CitationDraftInput[];
  readonly assessments: readonly ObservationAssessmentDraftInput[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withPrefix(issues: readonly ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.map((issue) => ({ field: `${prefix}.${issue.field}`, message: issue.message }));
}

export function parseObservationImport(raw: string): ValidationResult<ObservationImportRow[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid('json', 'The import is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    return invalid('json', 'The import must be a JSON array of observation objects.');
  }
  if (parsed.length === 0) {
    return invalid('json', 'The import array is empty.');
  }
  if (parsed.length > 200) {
    return invalid('json', 'Import at most 200 observations at a time.');
  }

  const issues: ValidationIssue[] = [];
  const rows: ObservationImportRow[] = [];
  parsed.forEach((value, index) => {
    const prefix = `rows[${String(index)}]`;
    const row = object(value);
    if (row === null) {
      issues.push({ field: prefix, message: 'Each import row must be an object.' });
      return;
    }
    const ordinalResult = integerInRange(
      row['query_ordinal'],
      `${prefix}.query_ordinal`,
      1,
      10_000,
    );
    if (!ordinalResult.ok) {
      issues.push(...ordinalResult.issues);
    }
    const observationResult = validateObservationDraftInput({
      queryId: 'import',
      status: row['status'],
      capturedAt: row['captured_at'],
      answerText: row['answer_text'],
      errorNote: row['error_note'],
      citationCapture: row['citation_capture'],
      contextNotes: row['context_notes'],
    });
    if (!observationResult.ok) {
      issues.push(...withPrefix(observationResult.issues, prefix));
    }

    const citations: CitationDraftInput[] = [];
    const rawCitations = row['citations'];
    if (rawCitations !== undefined && rawCitations !== null) {
      if (!Array.isArray(rawCitations)) {
        issues.push({ field: `${prefix}.citations`, message: 'Citations must be an array.' });
      } else if (rawCitations.length > 20) {
        issues.push({
          field: `${prefix}.citations`,
          message: 'Use 20 citations or fewer per observation.',
        });
      } else {
        rawCitations.forEach((rawCitation, citationIndex) => {
          const citation = object(rawCitation);
          if (citation === null) {
            issues.push({
              field: `${prefix}.citations[${String(citationIndex)}]`,
              message: 'Each citation must be an object.',
            });
            return;
          }
          const citationResult = validateCitationDraftInput({
            url: citation['url'],
            title: citation['title'],
            snippet: citation['snippet'],
            targetOwned: citation['target_owned'] === true ? 'on' : '',
          });
          if (citationResult.ok) {
            citations.push(citationResult.value);
          } else {
            issues.push(
              ...withPrefix(citationResult.issues, `${prefix}.citations[${String(citationIndex)}]`),
            );
          }
        });
      }
    }

    const assessments: ObservationAssessmentDraftInput[] = [];
    const rawAssessments = row['assessments'];
    if (rawAssessments !== undefined && rawAssessments !== null) {
      if (!Array.isArray(rawAssessments)) {
        issues.push({ field: `${prefix}.assessments`, message: 'Assessments must be an array.' });
      } else if (rawAssessments.length > 10) {
        issues.push({
          field: `${prefix}.assessments`,
          message: 'Use 10 assessments or fewer per observation.',
        });
      } else {
        rawAssessments.forEach((rawAssessment, assessmentIndex) => {
          const assessment = object(rawAssessment);
          if (assessment === null) {
            issues.push({
              field: `${prefix}.assessments[${String(assessmentIndex)}]`,
              message: 'Each assessment must be an object.',
            });
            return;
          }
          const assessmentResult = validateObservationAssessmentDraftInput({
            dimension: assessment['dimension'],
            label: assessment['label'],
            rationale: assessment['rationale'],
            reviewer: assessment['reviewer'],
            attributionRole: assessment['attribution_role'],
          });
          if (assessmentResult.ok) {
            assessments.push(assessmentResult.value);
          } else {
            issues.push(
              ...withPrefix(
                assessmentResult.issues,
                `${prefix}.assessments[${String(assessmentIndex)}]`,
              ),
            );
          }
        });
      }
    }

    if (
      observationResult.ok &&
      observationResult.value.status !== 'COMPLETED' &&
      assessments.length > 0
    ) {
      issues.push({
        field: `${prefix}.assessments`,
        message: 'Answer-level assessments are only valid for a completed observation.',
      });
    }

    if (ordinalResult.ok && observationResult.ok) {
      const { status, capturedAt, answerText, errorNote, citationCapture, contextNotes } =
        observationResult.value;
      rows.push({
        queryOrdinal: ordinalResult.value,
        observation: { status, capturedAt, answerText, errorNote, citationCapture, contextNotes },
        citations,
        assessments,
      });
    }
  });

  if (issues.length > 0) {
    return invalidMany(issues);
  }
  return valid(rows);
}
